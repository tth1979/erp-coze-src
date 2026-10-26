/**
 * 采购退货单服务端逻辑（po_returns / po_return_items）
 *
 * 状态机：draft → pending → approved(已出库) ↘ rejected | draft/pending → closed
 * 终审通过由 po_execute_return 单事务完成：状态 + 库存出库（移动加权成本扣减）+ 流水；
 * 库存不足（P0001）整事务回滚，单据保持 pending。
 * 应付联动：approved 退货总额由财务模块从供应商应付中冲减。
 */
import { z } from 'zod';
import { nextDocNo } from '@/server/doc-no';
import { ApiError } from '@/server/http';
import { emptyToNull, escapeOrKeyword, throwDbError, type ListQuery, type PagedResult } from '@/server/master-data/helpers';
import { approveCurrentStep, listSteps, rejectCurrentStep, submitDocument, type ApprovalStepView } from '@/server/approval/engine';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import type { PoReturn, PoReturnItem, SysUser } from '@/storage/database/shared/schema';

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export interface ReturnItemView {
  id: string;
  product_id: string;
  product_name: string | null;
  product_sku: string | null;
  quantity: number;
  unit_price: number;
  amount: number;
  unit: string | null;
}

export interface ReturnView {
  id: string;
  return_no: string;
  order_id: string | null;
  order_no: string | null;
  receipt_id: string | null;
  receipt_no: string | null;
  supplier_id: string;
  supplier_name: string | null;
  status: string;
  reason: string | null;
  total_amount: number;
  return_date: string;
  item_count: number;
  approval_level: number | null;
  current_step: number;
  reject_reason: string | null;
  remark: string | null;
  created_by_name: string | null;
  created_at: string;
  items?: ReturnItemView[];
  steps?: ApprovalStepView[];
}

// ---------------------------------------------------------------------------
// 校验
// ---------------------------------------------------------------------------

const uuid = z.string().regex(/^[0-9a-fA-F-]{36}$/, 'ID 格式不正确');

const itemSchema = z.object({
  product_id: uuid,
  quantity: z.number().positive('数量必须大于 0').max(9_999_999, '数量超出范围'),
  unit_price: z.number().min(0, '单价不能为负').max(99_999_999, '单价超出范围'),
});

export const returnCreateSchema = z.object({
  supplier_id: uuid,
  order_id: uuid.optional(),
  receipt_id: uuid.optional(),
  return_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 YYYY-MM-DD')
    .optional(),
  reason: z.string().max(500, '退货原因不能超过 500 字').optional(),
  remark: z.string().max(500, '备注不能超过 500 字').optional(),
  items: z.array(itemSchema).min(1, '至少需要一行明细').max(200, '明细行过多'),
});
export type ReturnCreateInput = z.infer<typeof returnCreateSchema>;

export const RETURN_STATUSES = ['draft', 'pending', 'approved', 'rejected', 'closed'] as const;

// ---------------------------------------------------------------------------
// 序列化与辅助
// ---------------------------------------------------------------------------

function toNumber(value: string | number | null): number {
  return value === null ? 0 : Number(value);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

async function fetchNameMap(
  table: 'md_products' | 'md_suppliers' | 'sys_users',
  ids: (string | null)[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const uniq = [...new Set(ids.filter((v): v is string => Boolean(v)))];
  if (uniq.length === 0) return map;
  const field = table === 'sys_users' ? 'display_name' : 'name';
  const { data } = await getSupabaseClient().from(table).select(`id, ${field}`).in('id', uniq);
  for (const row of (data ?? []) as unknown as Array<{ id: string; [k: string]: string }>) {
    map.set(row.id, row[field]);
  }
  return map;
}

async function fetchDocNoMap(table: 'po_purchase_orders' | 'po_receipts', col: 'order_no' | 'receipt_no', ids: (string | null)[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const uniq = [...new Set(ids.filter((v): v is string => Boolean(v)))];
  if (uniq.length === 0) return map;
  const { data } = await getSupabaseClient().from(table).select(`id, ${col}`).in('id', uniq);
  for (const row of (data ?? []) as unknown as Array<{ id: string; [k: string]: string }>) {
    map.set(row.id, row[col]);
  }
  return map;
}

function serialize(row: PoReturn, extra: Partial<ReturnView> = {}): ReturnView {
  return {
    id: row.id,
    return_no: row.return_no,
    order_id: row.order_id,
    order_no: extra.order_no ?? null,
    receipt_id: row.receipt_id,
    receipt_no: extra.receipt_no ?? null,
    supplier_id: row.supplier_id,
    supplier_name: extra.supplier_name ?? null,
    status: row.status,
    reason: row.reason,
    total_amount: toNumber(row.total_amount),
    return_date: row.return_date,
    item_count: extra.item_count ?? 0,
    approval_level: row.approval_level,
    current_step: row.current_step,
    reject_reason: row.reject_reason,
    remark: row.remark,
    created_by_name: extra.created_by_name ?? null,
    created_at: new Date(row.created_at).toISOString(),
    items: extra.items,
    steps: extra.steps,
  };
}

/** 退货单号 RTyyyymmdd-NNNN */
async function generateReturnNo(): Promise<string> {
  return nextDocNo('RT', 'po_returns', 'return_no');
}

// ---------------------------------------------------------------------------
// 查询
// ---------------------------------------------------------------------------

export async function listReturns(query: ListQuery & { status?: string }): Promise<PagedResult<ReturnView>> {
  const supabase = getSupabaseClient();
  let builder = supabase
    .from('po_returns')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false });

  if (query.status && (RETURN_STATUSES as readonly string[]).includes(query.status)) {
    builder = builder.eq('status', query.status);
  }
  if (query.keyword) {
    const kw = escapeOrKeyword(query.keyword);
    if (kw) builder = builder.or(`return_no.ilike.%${kw}%,reason.ilike.%${kw}%`);
  }

  const from = (query.page - 1) * query.pageSize;
  const { data, error, count } = await builder.range(from, from + query.pageSize - 1);
  if (error) throwDbError(error, '查询采购退货单');

  const rows = (data ?? []) as PoReturn[];
  const supplierNames = await fetchNameMap('md_suppliers', rows.map((r) => r.supplier_id));
  const creatorNames = await fetchNameMap('sys_users', rows.map((r) => r.created_by));
  const orderNos = await fetchDocNoMap('po_purchase_orders', 'order_no', rows.map((r) => r.order_id));
  const receiptNos = await fetchDocNoMap('po_receipts', 'receipt_no', rows.map((r) => r.receipt_id));

  const ids = rows.map((r) => r.id);
  const itemCounts = new Map<string, number>();
  if (ids.length > 0) {
    const { data: itemRows } = await supabase.from('po_return_items').select('return_id').in('return_id', ids);
    for (const item of (itemRows ?? []) as Array<{ return_id: string }>) {
      itemCounts.set(item.return_id, (itemCounts.get(item.return_id) ?? 0) + 1);
    }
  }

  return {
    items: rows.map((row) =>
      serialize(row, {
        supplier_name: supplierNames.get(row.supplier_id),
        order_no: row.order_id ? orderNos.get(row.order_id) : null,
        receipt_no: row.receipt_id ? receiptNos.get(row.receipt_id) : null,
        item_count: itemCounts.get(row.id) ?? 0,
        created_by_name: row.created_by ? creatorNames.get(row.created_by) : null,
      }),
    ),
    total: count ?? 0,
    page: query.page,
    page_size: query.pageSize,
  };
}

export async function getReturn(id: string): Promise<ReturnView> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('po_returns').select('*').eq('id', id).maybeSingle();
  if (error) throwDbError(error, '查询采购退货单');
  if (!data) throw new ApiError(404, 'PO.NOT_FOUND', '采购退货单不存在');
  const row = data as PoReturn;

  const { data: itemRows, error: itemErr } = await supabase
    .from('po_return_items')
    .select('*')
    .eq('return_id', id)
    .order('created_at', { ascending: true });
  if (itemErr) throwDbError(itemErr, '查询退货明细');
  const items = (itemRows ?? []) as PoReturnItem[];

  const productNames = await fetchNameMap('md_products', items.map((i) => i.product_id));
  const skuMap = new Map<string, string>();
  if (items.length > 0) {
    const { data: products } = await supabase
      .from('md_products')
      .select('id, sku_code')
      .in('id', [...new Set(items.map((i) => i.product_id))]);
    for (const p of products ?? []) skuMap.set(p.id as string, p.sku_code as string);
  }
  const supplierNames = await fetchNameMap('md_suppliers', [row.supplier_id]);
  const creatorNames = await fetchNameMap('sys_users', [row.created_by]);
  const orderNos = await fetchDocNoMap('po_purchase_orders', 'order_no', [row.order_id]);
  const receiptNos = await fetchDocNoMap('po_receipts', 'receipt_no', [row.receipt_id]);
  const steps = await listSteps('return', id);

  const itemViews: ReturnItemView[] = items.map((item) => ({
    id: item.id,
    product_id: item.product_id,
    product_name: productNames.get(item.product_id) ?? null,
    product_sku: skuMap.get(item.product_id) ?? null,
    quantity: toNumber(item.quantity),
    unit_price: toNumber(item.unit_price),
    amount: toNumber(item.amount),
    unit: item.unit,
  }));

  return serialize(row, {
    supplier_name: supplierNames.get(row.supplier_id),
    order_no: row.order_id ? orderNos.get(row.order_id) : null,
    receipt_no: row.receipt_id ? receiptNos.get(row.receipt_id) : null,
    item_count: itemViews.length,
    created_by_name: row.created_by ? creatorNames.get(row.created_by) : null,
    items: itemViews,
    steps,
  });
}

// ---------------------------------------------------------------------------
// 写入
// ---------------------------------------------------------------------------

/** 新建退货单（draft）：供应商必填，可关联订单/入库单 */
export async function createReturn(input: ReturnCreateInput, operatorId: string): Promise<ReturnView> {
  const supabase = getSupabaseClient();

  const { data: supplier, error: sErr } = await supabase
    .from('md_suppliers')
    .select('id, status')
    .eq('id', input.supplier_id)
    .maybeSingle();
  if (sErr) throwDbError(sErr, '校验供应商');
  if (!supplier) throw new ApiError(400, 'PO.SUPPLIER_NOT_FOUND', '供应商不存在');

  // 关联单据校验（归属同一供应商）
  if (input.order_id) {
    const { data: order } = await supabase
      .from('po_purchase_orders')
      .select('id, supplier_id')
      .eq('id', input.order_id)
      .maybeSingle();
    if (!order || order.supplier_id !== input.supplier_id) {
      throw new ApiError(400, 'PO.ORDER_MISMATCH', '关联订单不存在或不属于该供应商');
    }
  }
  if (input.receipt_id) {
    const { data: receipt } = await supabase
      .from('po_receipts')
      .select('id, supplier_id')
      .eq('id', input.receipt_id)
      .maybeSingle();
    if (!receipt || receipt.supplier_id !== input.supplier_id) {
      throw new ApiError(400, 'PO.RECEIPT_MISMATCH', '关联入库单不存在或不属于该供应商');
    }
  }

  // 商品与金额
  const productIds = [...new Set(input.items.map((i) => i.product_id))];
  const { data: products, error: pErr } = await supabase.from('md_products').select('id, unit').in('id', productIds);
  if (pErr) throwDbError(pErr, '校验商品');
  const productMap = new Map((products ?? []).map((p) => [p.id as string, p]));
  for (const pid of productIds) {
    if (!productMap.has(pid)) throw new ApiError(400, 'PO.PRODUCT_NOT_FOUND', '存在无效商品');
  }

  let total = 0;
  const items = input.items.map((item) => {
    const amount = round2(item.quantity * item.unit_price);
    total = round2(total + amount);
    return { ...item, amount, unit: (productMap.get(item.product_id)?.unit as string | null) ?? null };
  });

  let row: PoReturn | null = null;
  for (let attempt = 0; attempt < 2 && !row; attempt += 1) {
    const returnNo = await generateReturnNo();
    const { data, error } = await supabase
      .from('po_returns')
      .insert({
        return_no: returnNo,
        supplier_id: input.supplier_id,
        order_id: input.order_id ?? null,
        receipt_id: input.receipt_id ?? null,
        status: 'draft',
        reason: emptyToNull(input.reason),
        total_amount: total,
        return_date: input.return_date ?? new Date().toISOString().slice(0, 10),
        remark: emptyToNull(input.remark),
        created_by: operatorId,
      })
      .select('*')
      .single();
    if (error) {
      if (error.code === '23505' && attempt === 0) continue;
      throwDbError(error, '创建采购退货单');
    }
    row = data as PoReturn;
  }
  if (!row) throw new ApiError(500, 'PO.DB_ERROR', '创建采购退货单失败');

  const { error: itemErr } = await supabase
    .from('po_return_items')
    .insert(items.map((item) => ({ ...item, return_id: row.id })));
  if (itemErr) {
    await supabase.from('po_returns').delete().eq('id', row.id);
    throwDbError(itemErr, '保存退货明细');
  }
  return getReturn(row.id);
}

export async function deleteReturn(id: string): Promise<void> {
  const supabase = getSupabaseClient();
  const existing = await getReturn(id);
  if (existing.status !== 'draft') {
    throw new ApiError(400, 'PO.NOT_DRAFT', '只有草稿状态的退货单可以删除');
  }
  const { error } = await supabase.from('po_returns').delete().eq('id', id);
  if (error) throwDbError(error, '删除采购退货单');
}

/** 关闭退货单：draft/pending/rejected → closed */
export async function closeReturn(id: string): Promise<ReturnView> {
  const supabase = getSupabaseClient();
  const existing = await getReturn(id);
  if (!['draft', 'pending', 'rejected'].includes(existing.status)) {
    throw new ApiError(400, 'PO.BAD_TRANSITION', '当前状态不允许关闭');
  }
  const { error } = await supabase
    .from('po_returns')
    .update({ status: 'closed', updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throwDbError(error, '关闭退货单');
  return getReturn(id);
}

export async function submitReturn(id: string, user: SysUser): Promise<ReturnView> {
  const existing = await getReturn(id);
  await submitDocument('return', id, existing.total_amount, user);
  return getReturn(id);
}

/** 审核通过（终审由 po_execute_return 完成出库；库存不足整单回滚） */
export async function approveReturn(id: string, user: SysUser, comment?: string): Promise<ReturnView> {
  await approveCurrentStep('return', id, user, comment);
  return getReturn(id);
}

export async function rejectReturn(id: string, user: SysUser, reason: string): Promise<ReturnView> {
  await rejectCurrentStep('return', id, user, reason);
  return getReturn(id);
}
