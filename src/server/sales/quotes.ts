/**
 * 报价单服务端逻辑（so_quotes / so_quote_items，0023）
 *
 * 状态机：draft(草稿) → sent(已发出) → accepted(已接受) → converted(已转订单)
 *                ↘ void(作废，任意非 converted 态可作废，作废后不可转单)
 *                ↘ expired(已过期，sent/accepted 且 valid_until 过期后可标记)
 * 仅 draft 可编辑/删除；转订单生成 draft 销售订单并回写 quote_id。
 */
import { z } from 'zod';
import { nextDocNo } from '@/server/doc-no';
import { ApiError } from '@/server/http';
import { colorNameOf, normalizeColorCode, resolveItemColors } from '@/server/master-data/colors';
import { emptyToNull, escapeOrKeyword, throwDbError, type ListQuery, type PagedResult } from '@/server/master-data/helpers';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import type { SoQuote } from '@/storage/database/shared/schema';

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export interface QuoteItemView {
  id: string;
  product_id: string;
  product_name: string | null;
  product_sku: string | null;
  product_spec: string | null;
  color_code: string;
  color_name: string | null;
  quantity: number;
  unit: string | null;
  unit_price: number;
  discount_rate: number;
  amount: number;
  tax_rate: number;
}

export interface QuoteView {
  id: string;
  quote_no: string;
  customer_id: string;
  customer_name: string | null;
  customer_level: string | null;
  quote_date: string;
  valid_until: string | null;
  salesman: string | null;
  status: string;
  total_amount: number;
  remark: string | null;
  converted_order_id: string | null;
  converted_order_no: string | null;
  converted_at: string | null;
  void_reason: string | null;
  created_by_name: string | null;
  item_count: number;
  created_at: string;
  items?: QuoteItemView[];
}

// ---------------------------------------------------------------------------
// 校验
// ---------------------------------------------------------------------------

const uuid = z.string().regex(/^[0-9a-fA-F-]{36}$/, 'ID 格式不正确');
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 YYYY-MM-DD');

const itemSchema = z.object({
  product_id: uuid,
  color_code: z.string().max(32, '色号编码不能超过 32 字').optional(),
  quantity: z.number().positive('数量必须大于 0').max(9_999_999, '数量超出范围'),
  unit_price: z.number().min(0, '单价不能为负').max(99_999_999, '单价超出范围'),
  discount_rate: z.number().positive('折扣率必须大于 0').max(100, '折扣率不能超过 100').default(100),
  tax_rate: z.number().min(0, '税率不能为负').max(100, '税率超出范围').default(13),
});

export const quoteUpsertSchema = z.object({
  customer_id: uuid,
  quote_date: dateStr.optional(),
  valid_until: dateStr.nullish(),
  salesman: z.string().max(64, '业务员不能超过 64 字').nullish(),
  remark: z.string().max(500, '备注不能超过 500 字').nullish(),
  items: z.array(itemSchema).min(1, '至少需要一行明细').max(200, '明细行过多'),
});
export type QuoteUpsertInput = z.infer<typeof quoteUpsertSchema>;

export const quoteVoidSchema = z.object({
  reason: z.string().min(1, '作废原因不能为空').max(200, '作废原因不能超过 200 字'),
});

export const QUOTE_STATUSES = ['draft', 'sent', 'accepted', 'converted', 'expired', 'void'] as const;

// ---------------------------------------------------------------------------
// 序列化与取数
// ---------------------------------------------------------------------------

function toNumber(value: string | number | null): number {
  return value === null ? 0 : Number(value);
}

function serializeHead(row: SoQuote, extra: Partial<QuoteView> = {}): QuoteView {
  return {
    id: row.id,
    quote_no: row.quote_no,
    customer_id: row.customer_id,
    customer_name: extra.customer_name ?? null,
    customer_level: extra.customer_level ?? null,
    quote_date: row.quote_date,
    valid_until: row.valid_until ?? null,
    salesman: row.salesman ?? null,
    status: row.status,
    total_amount: toNumber(row.total_amount),
    remark: row.remark,
    converted_order_id: row.converted_order_id ?? null,
    converted_order_no: extra.converted_order_no ?? null,
    converted_at: row.converted_at ? new Date(row.converted_at).toISOString() : null,
    void_reason: row.void_reason ?? null,
    created_by_name: extra.created_by_name ?? null,
    item_count: extra.item_count ?? 0,
    created_at: new Date(row.created_at).toISOString(),
    items: extra.items,
  };
}

async function fetchQuoteItems(quoteId: string): Promise<QuoteItemView[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('so_quote_items')
    .select('id, product_id, color_code, color_name, quantity, unit, unit_price, discount_rate, amount, tax_rate')
    .eq('quote_id', quoteId)
    .order('created_at', { ascending: true });
  if (error) throwDbError(error, '查询报价明细');
  const rows = data ?? [];
  const productIds = [...new Set(rows.map((r) => r.product_id as string))];
  const productMap = new Map<string, { name: string; sku: string; spec: string | null }>();
  if (productIds.length > 0) {
    const { data: products, error: pErr } = await supabase
      .from('md_products')
      .select('id, name, sku_code, spec')
      .in('id', productIds);
    if (pErr) throwDbError(pErr, '查询商品');
    for (const p of products ?? []) {
      productMap.set(p.id as string, { name: p.name as string, sku: p.sku_code as string, spec: (p.spec as string | null) ?? null });
    }
  }
  return rows.map((r) => ({
    id: r.id as string,
    product_id: r.product_id as string,
    product_name: productMap.get(r.product_id as string)?.name ?? null,
    product_sku: productMap.get(r.product_id as string)?.sku ?? null,
    product_spec: productMap.get(r.product_id as string)?.spec ?? null,
    color_code: (r.color_code as string) ?? '',
    color_name: (r.color_name as string | null) ?? null,
    quantity: Number(r.quantity),
    unit: (r.unit as string | null) ?? null,
    unit_price: Number(r.unit_price),
    discount_rate: Number(r.discount_rate),
    amount: Number(r.amount),
    tax_rate: Number(r.tax_rate),
  }));
}

// ---------------------------------------------------------------------------
// 明细准备（服务端重算金额，色号校验沿用 0022 口径）
// ---------------------------------------------------------------------------

async function prepareItems(input: QuoteUpsertInput) {
  const supabase = getSupabaseClient();
  const productIds = [...new Set(input.items.map((i) => i.product_id))];
  const { data: products, error } = await supabase
    .from('md_products')
    .select('id, unit, status')
    .in('id', productIds);
  if (error) throwDbError(error, '查询商品');
  const productMap = new Map((products ?? []).map((p) => [p.id as string, p]));
  for (const item of input.items) {
    const p = productMap.get(item.product_id);
    if (!p) throw new ApiError(404, 'SO.PRODUCT_NOT_FOUND', '商品不存在');
    if ((p.status as string) !== 'active') throw new ApiError(400, 'SO.PRODUCT_DISABLED', '商品已停用，不能报价');
  }
  // 同 型号+色号 重复行拦截
  const seen = new Set<string>();
  for (const item of input.items) {
    const key = `${item.product_id}|${normalizeColorCode(item.color_code)}`;
    if (seen.has(key)) throw new ApiError(400, 'SO.ITEM_DUPLICATED', '同一单据中 型号+色号 不能重复');
    seen.add(key);
  }
  const colorNames = await resolveItemColors(input.items);
  let total = 0;
  const items = input.items.map((item) => {
    const amount = Math.round(item.quantity * item.unit_price * (item.discount_rate / 100) * 100) / 100;
    total = Math.round((total + amount) * 100) / 100;
    return {
      product_id: item.product_id,
      color_code: normalizeColorCode(item.color_code),
      color_name: colorNameOf(colorNames, item.product_id, item.color_code),
      quantity: item.quantity,
      unit: (productMap.get(item.product_id)?.unit as string | null) ?? null,
      unit_price: item.unit_price,
      discount_rate: item.discount_rate,
      amount,
      tax_rate: item.tax_rate,
    };
  });
  return { items, total };
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export interface QuoteListQuery extends ListQuery {
  status?: string;
  customer_id?: string;
  date_from?: string;
  date_to?: string;
}

export async function listQuotes(q: QuoteListQuery): Promise<PagedResult<QuoteView>> {
  const supabase = getSupabaseClient();
  let builder = supabase.from('so_quotes').select('*', { count: 'exact' });
  if (q.status) builder = builder.eq('status', q.status);
  if (q.customer_id) builder = builder.eq('customer_id', q.customer_id);
  if (q.date_from) builder = builder.gte('quote_date', q.date_from);
  if (q.date_to) builder = builder.lte('quote_date', q.date_to);
  if (q.keyword) {
    const kw = escapeOrKeyword(q.keyword);
    if (kw) builder = builder.or(`quote_no.ilike.%${kw}%,salesman.ilike.%${kw}%,remark.ilike.%${kw}%`);
  }
  const from = (q.page - 1) * q.pageSize;
  const { data, error, count } = await builder
    .order('created_at', { ascending: false })
    .range(from, from + q.pageSize - 1);
  if (error) throwDbError(error, '查询报价单');
  const rows = (data ?? []) as SoQuote[];
  const views = await hydrateHeads(rows);
  return { items: views, total: count ?? 0, page: q.page, page_size: q.pageSize };
}

/** 头行补充：客户名/等级、操作人、明细数、转订单号 */
async function hydrateHeads(rows: SoQuote[]): Promise<QuoteView[]> {
  if (rows.length === 0) return [];
  const supabase = getSupabaseClient();
  const customerIds = [...new Set(rows.map((r) => r.customer_id))];
  const userIds = [...new Set(rows.map((r) => r.created_by).filter((v): v is string => Boolean(v)))];
  const orderIds = [...new Set(rows.map((r) => r.converted_order_id).filter((v): v is string => Boolean(v)))];
  const quoteIds = rows.map((r) => r.id);

  const [customers, users, orders, itemsCount] = await Promise.all([
    supabase.from('md_customers').select('id, name, level').in('id', customerIds),
    userIds.length ? supabase.from('sys_users').select('id, username, display_name').in('id', userIds) : Promise.resolve({ data: [], error: null }),
    orderIds.length ? supabase.from('so_sales_orders').select('id, order_no').in('id', orderIds) : Promise.resolve({ data: [], error: null }),
    supabase.from('so_quote_items').select('quote_id').in('quote_id', quoteIds),
  ]);
  if (customers.error) throwDbError(customers.error, '查询客户');
  if (users.error) throwDbError(users.error, '查询用户');
  if (orders.error) throwDbError(orders.error, '查询订单');
  if (itemsCount.error) throwDbError(itemsCount.error, '统计报价明细');

  const customerMap = new Map((customers.data ?? []).map((c) => [c.id as string, { name: c.name as string, level: c.level as string }]));
  const userMap = new Map(
    ((users.data ?? []) as Array<Record<string, unknown>>).map((u) => [
      u.id as string,
      ((u.display_name as string | null) ?? (u.username as string)) as string,
    ]),
  );
  const orderMap = new Map(((orders.data ?? []) as Array<Record<string, unknown>>).map((o) => [o.id as string, o.order_no as string]));
  const countMap = new Map<string, number>();
  for (const it of itemsCount.data ?? []) {
    const qid = it.quote_id as string;
    countMap.set(qid, (countMap.get(qid) ?? 0) + 1);
  }
  return rows.map((r) =>
    serializeHead(r, {
      customer_name: customerMap.get(r.customer_id)?.name ?? null,
      customer_level: customerMap.get(r.customer_id)?.level ?? null,
      created_by_name: r.created_by ? (userMap.get(r.created_by) ?? null) : null,
      converted_order_no: r.converted_order_id ? (orderMap.get(r.converted_order_id) ?? null) : null,
      item_count: countMap.get(r.id) ?? 0,
    }),
  );
}

export async function getQuote(id: string): Promise<QuoteView> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('so_quotes').select('*').eq('id', id).maybeSingle();
  if (error) throwDbError(error, '查询报价单');
  if (!data) throw new ApiError(404, 'SO.QUOTE_NOT_FOUND', '报价单不存在');
  const [head] = await hydrateHeads([data as SoQuote]);
  const items = await fetchQuoteItems(id);
  return { ...head, items };
}

export async function createQuote(input: QuoteUpsertInput, userId: string, salesmanName?: string | null): Promise<QuoteView> {
  const supabase = getSupabaseClient();
  const { items, total } = await prepareItems(input);
  const quoteDate = input.quote_date ?? new Date().toISOString().slice(0, 10);
  if (input.valid_until && input.valid_until < quoteDate) {
    throw new ApiError(400, 'SO.QUOTE_BAD_VALIDITY', '有效期至不能早于报价日期');
  }

  let quote: { id: string } | null = null;
  for (let attempt = 0; attempt < 2 && !quote; attempt += 1) {
    const quoteNo = await nextDocNo('QO', 'so_quotes', 'quote_no');
    const { data, error } = await supabase
      .from('so_quotes')
      .insert({
        quote_no: quoteNo,
        customer_id: input.customer_id,
        quote_date: quoteDate,
        valid_until: input.valid_until ?? null,
        salesman: emptyToNull(input.salesman ?? salesmanName ?? null),
        status: 'draft',
        total_amount: total,
        remark: emptyToNull(input.remark),
        created_by: userId,
      })
      .select('id')
      .single();
    if (error) {
      if (error.code === '23505' && attempt === 0) continue;
      throwDbError(error, '创建报价单');
    }
    quote = data as { id: string };
  }
  if (!quote) throw new ApiError(500, 'SO.DB_ERROR', '创建报价单失败');

  const { error: itemErr } = await supabase
    .from('so_quote_items')
    .insert(items.map((item) => ({ ...item, quote_id: quote!.id })));
  if (itemErr) {
    await supabase.from('so_quotes').delete().eq('id', quote.id);
    throwDbError(itemErr, '保存报价明细');
  }
  return getQuote(quote.id);
}

export async function updateQuote(id: string, input: QuoteUpsertInput): Promise<QuoteView> {
  const existing = await getQuote(id);
  if (existing.status !== 'draft') {
    throw new ApiError(400, 'SO.QUOTE_NOT_DRAFT', '只有草稿状态的报价单可以编辑');
  }
  const quoteDate = input.quote_date ?? existing.quote_date;
  if (input.valid_until && input.valid_until < quoteDate) {
    throw new ApiError(400, 'SO.QUOTE_BAD_VALIDITY', '有效期至不能早于报价日期');
  }
  const { items, total } = await prepareItems(input);
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('so_quotes')
    .update({
      customer_id: input.customer_id,
      quote_date: quoteDate,
      valid_until: input.valid_until ?? null,
      salesman: emptyToNull(input.salesman ?? existing.salesman),
      remark: emptyToNull(input.remark),
      total_amount: total,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) throwDbError(error, '更新报价单');
  const { error: delErr } = await supabase.from('so_quote_items').delete().eq('quote_id', id);
  if (delErr) throwDbError(delErr, '更新报价明细');
  const { error: insErr } = await supabase
    .from('so_quote_items')
    .insert(items.map((item) => ({ ...item, quote_id: id })));
  if (insErr) throwDbError(insErr, '更新报价明细');
  return getQuote(id);
}

export async function deleteQuote(id: string): Promise<void> {
  const existing = await getQuote(id);
  if (existing.status !== 'draft') {
    throw new ApiError(400, 'SO.QUOTE_NOT_DRAFT', '只有草稿状态的报价单可以删除');
  }
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('so_quotes').delete().eq('id', id);
  if (error) throwDbError(error, '删除报价单');
}

// ---------------------------------------------------------------------------
// 状态流转
// ---------------------------------------------------------------------------

async function transition(id: string, from: string[], patch: Record<string, unknown>, action: string): Promise<QuoteView> {
  const existing = await getQuote(id);
  if (!from.includes(existing.status)) {
    throw new ApiError(400, 'SO.QUOTE_BAD_TRANSITION', `${action}失败：当前状态（${existing.status}）不允许该操作`);
  }
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('so_quotes')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', existing.status);
  if (error) throwDbError(error, action);
  return getQuote(id);
}

/** 提交发出：draft → sent */
export async function submitQuote(id: string): Promise<QuoteView> {
  return transition(id, ['draft'], { status: 'sent', sent_at: new Date().toISOString() }, '提交报价单');
}

/** 客户接受：sent → accepted */
export async function acceptQuote(id: string): Promise<QuoteView> {
  return transition(id, ['sent'], { status: 'accepted', accepted_at: new Date().toISOString() }, '接受报价单');
}

/** 作废：任意非 converted 终态 → void（作废后不可转单） */
export async function voidQuote(id: string, reason: string): Promise<QuoteView> {
  return transition(id, ['draft', 'sent', 'accepted', 'expired'], { status: 'void', void_reason: reason }, '作废报价单');
}

/** 标记过期：sent/accepted → expired */
export async function expireQuote(id: string): Promise<QuoteView> {
  return transition(id, ['sent', 'accepted'], { status: 'expired' }, '标记报价过期');
}

// ---------------------------------------------------------------------------
// 转销售订单
// ---------------------------------------------------------------------------

export interface ConvertQuoteContext {
  operatorId: string;
  operatorName: string;
  permissions: string[];
  /** 强制通过信用校验的原因（需 so.approve 权限） */
  forceReason?: string | null;
  ip?: string | null;
}

/** 报价转销售订单：sent/accepted → converted，生成 draft 销售订单并回写 quote_id */
export async function convertQuote(id: string, ctx: ConvertQuoteContext): Promise<QuoteView> {
  const existing = await getQuote(id);
  if (existing.converted_order_id) {
    throw new ApiError(400, 'SO.QUOTE_ALREADY_CONVERTED', '报价单已转订单，不可重复转换');
  }
  if (existing.status === 'void') {
    throw new ApiError(400, 'SO.QUOTE_VOID', '报价单已作废，不可转订单');
  }
  if (!['sent', 'accepted'].includes(existing.status)) {
    throw new ApiError(400, 'SO.STATUS_INVALID', `当前状态（${existing.status}）不允许转订单，须为已发出/已接受`);
  }
  const items = existing.items ?? [];
  if (items.length === 0) throw new ApiError(400, 'SO.ITEMS_REQUIRED', '报价单没有明细，无法转订单');

  // 信用校验：按报价含税总额计入占用（折后）
  const applyAmount = items.reduce((s, it) => s + it.amount, 0);
  const { assertCreditAvailable } = await import('./credit');
  await assertCreditAvailable(existing.customer_id, Math.round(applyAmount * 100) / 100, {
    scene: 'quote_convert',
    docId: id,
    docNo: existing.quote_no,
    forceReason: ctx.forceReason,
    operator: { id: ctx.operatorId, username: ctx.operatorName, permissions: ctx.permissions },
    ip: ctx.ip,
  });

  // 生成 draft 销售订单（沿用既有 createOrder：服务端重算、色号校验、单号引擎）
  const { createOrder } = await import('./orders');
  const order = await createOrder(
    {
      customer_id: existing.customer_id,
      order_date: new Date().toISOString().slice(0, 10),
      remark: `由报价单 ${existing.quote_no} 转入${existing.remark ? `；${existing.remark}` : ''}`,
      warehouse_id: null,
      items: items.map((it) => ({
        product_id: it.product_id,
        quantity: it.quantity,
        unit_price: Math.round((it.unit_price * it.discount_rate) / 100 * 100) / 100,
        color_code: it.color_code || undefined,
      })),
    },
    ctx.operatorId,
  );

  // 回写订单 quote_id（外键已在迁移中建立）
  const supabase = getSupabaseClient();
  const { error: linkErr } = await supabase
    .from('so_sales_orders')
    .update({ quote_id: id })
    .eq('id', order.id);
  if (linkErr) throwDbError(linkErr, '回写订单报价来源');

  // 报价单状态 → converted（乐观锁防并发重复转换）
  const { data: updated, error: upErr } = await supabase
    .from('so_quotes')
    .update({
      status: 'converted',
      converted_order_id: order.id,
      converted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .in('status', ['sent', 'accepted'])
    .select('id')
    .maybeSingle();
  if (upErr) throwDbError(upErr, '更新报价单状态');
  if (!updated) {
    throw new ApiError(409, 'SO.STATUS_CONFLICT', '报价单状态已变化，请刷新后重试（生成的订单仍有效）');
  }
  return getQuote(id);
}
