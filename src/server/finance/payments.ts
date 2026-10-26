/**
 * 财务服务端逻辑（fin_*）：收付款台账 + 应收/应付欠款聚合
 *
 * 模型：
 * - fin_payments 一表双向（direction=receipt 收款→客户 / payment 付款→供应商）
 * - 欠款不落库，实时聚合：
 *     客户欠款   = Σ(so_sales_orders.completed.total_amount) − Σ(receipt)
 *     供应商欠款 = Σ(po_purchase_orders.received.total_amount) − Σ(po_returns.approved)
 *                  + Σ(蓝字冲回) − Σ(红字暂估) − Σ(payment)
 *
 * 规则：
 * - 金额一律服务端校验 >0；收/付款不得超过该往来单位当前欠款（防止错账），
 *   预收/预付科目留待后续里程碑。
 * - 单据创建即生效；删除即回滚欠款（MVP 简化，后续改红冲）。
 * - 单号 RC/PYyyyymmdd-NNNN，唯一约束冲突（23505）重试一次。
 *
 * 实现说明：
 * PostgREST .or() 不支持嵌入表列名前缀，按往来单位名称/编码模糊搜索时采用
 * 「先查匹配的 partner_id，再 in 过滤」两步法（同库存模块）。
 */
import { z } from 'zod';
import { ApiError } from '@/server/http';
import { emptyToNull, escapeOrKeyword, throwDbError, type ListQuery, type PagedResult } from '@/server/master-data/helpers';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import type { FinPayment } from '@/storage/database/shared/schema';

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export type PaymentDirection = 'receipt' | 'payment';

export interface PaymentView {
  id: string;
  doc_no: string;
  direction: PaymentDirection;
  customer_id: string | null;
  customer_name: string | null;
  supplier_id: string | null;
  supplier_name: string | null;
  order_id: string | null;
  order_no: string | null;
  amount: number;
  method: string;
  paid_at: string;
  remark: string | null;
  created_by_name: string | null;
  created_at: string;
}

/** 应收欠款聚合行（按客户） */
export interface ReceivableRow {
  customer_id: string;
  code: string;
  name: string;
  contact: string | null;
  phone: string | null;
  /** 已完成销售总额（应收） */
  billed: number;
  /** 已收款合计 */
  received: number;
  /** 当前欠款 = billed - received */
  outstanding: number;
}

/** 应付欠款聚合行（按供应商） */
export interface PayableRow {
  supplier_id: string;
  code: string;
  name: string;
  contact: string | null;
  phone: string | null;
  billed: number;
  paid: number;
  outstanding: number;
}

// ---------------------------------------------------------------------------
// 校验
// ---------------------------------------------------------------------------

const uuid = z.string().regex(/^[0-9a-fA-F-]{36}$/, 'ID 格式不正确');

export const PAYMENT_METHODS = ['cash', 'bank', 'wechat', 'alipay', 'other'] as const;

const baseFields = {
  amount: z
    .number()
    .positive('金额必须大于 0')
    .max(99_999_999.99, '金额超出范围')
    .refine((v) => Math.round(v * 100) === v * 100 || Math.abs(Math.round(v * 100) - v * 100) < 1e-6, '金额最多两位小数'),
  method: z.enum(PAYMENT_METHODS).default('bank'),
  paid_at: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 YYYY-MM-DD')
    .optional(),
  order_id: uuid.optional(),
  remark: z.string().max(500, '备注不能超过 500 字').optional(),
};

export const receiptCreateSchema = z.object({
  customer_id: uuid,
  ...baseFields,
});
export type ReceiptCreateInput = z.infer<typeof receiptCreateSchema>;

export const paymentCreateSchema = z.object({
  supplier_id: uuid,
  ...baseFields,
});
export type PaymentCreateInput = z.infer<typeof paymentCreateSchema>;

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
  table: 'md_customers' | 'md_suppliers' | 'sys_users',
  ids: (string | null)[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const uniq = [...new Set(ids.filter((v): v is string => Boolean(v)))];
  if (uniq.length === 0) return map;
  const field = table === 'sys_users' ? 'display_name' : 'name';
  const { data, error } = await getSupabaseClient().from(table).select(`id, ${field}`).in('id', uniq);
  if (error) throwDbError(error, '查询关联名称');
  for (const row of (data ?? []) as unknown as Array<{ id: string; [k: string]: string }>) {
    map.set(row.id, row[field]);
  }
  return map;
}

function serialize(row: FinPayment, names: { partner?: string | null; creator?: string | null }): PaymentView {
  return {
    id: row.id,
    doc_no: row.doc_no,
    direction: row.direction as PaymentDirection,
    customer_id: row.customer_id,
    customer_name: row.direction === 'receipt' ? (names.partner ?? null) : null,
    supplier_id: row.supplier_id,
    supplier_name: row.direction === 'payment' ? (names.partner ?? null) : null,
    order_id: row.order_id,
    order_no: row.order_no,
    amount: toNumber(row.amount),
    method: row.method,
    paid_at: row.paid_at,
    remark: row.remark,
    created_by_name: names.creator ?? null,
    created_at: new Date(row.created_at).toISOString(),
  };
}

/** 生成单号 RC/PYyyyymmdd-NNNN（唯一冲突由调用方重试） */
async function generateDocNo(direction: PaymentDirection): Promise<string> {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const prefix = `${direction === 'receipt' ? 'RC' : 'PY'}${y}${m}${d}`;
  const { count, error } = await getSupabaseClient()
    .from('fin_payments')
    .select('id', { count: 'exact', head: true })
    .like('doc_no', `${prefix}%`);
  if (error) throwDbError(error, '生成收付款单号');
  return `${prefix}-${String((count ?? 0) + 1).padStart(4, '0')}`;
}

// ---------------------------------------------------------------------------
// 欠款聚合（供创建校验与列表共用）
// ---------------------------------------------------------------------------

/** 某客户的应收汇总：completed 销售总额与已收款合计 */
async function sumCustomer(customerId: string): Promise<{ billed: number; received: number }> {
  const supabase = getSupabaseClient();
  const [{ data: orders, error: oErr }, { data: receipts, error: rErr }] = await Promise.all([
    supabase.from('so_sales_orders').select('total_amount').eq('status', 'completed').eq('customer_id', customerId),
    supabase.from('fin_payments').select('amount').eq('direction', 'receipt').eq('customer_id', customerId),
  ]);
  if (oErr) throwDbError(oErr, '统计客户应收');
  if (rErr) throwDbError(rErr, '统计客户已收');
  const billed = round2((orders ?? []).reduce((s, r) => s + toNumber(r.total_amount as string), 0));
  const received = round2((receipts ?? []).reduce((s, r) => s + toNumber(r.amount as string), 0));
  return { billed, received };
}

/** 某供应商的应付汇总（订单已入库总额 + 退货/冲回调整） */
async function sumSupplier(supplierId: string): Promise<{ billed: number; paid: number }> {
  const supabase = getSupabaseClient();
  const [{ data: orders, error: oErr }, { data: payments, error: pErr }] = await Promise.all([
    supabase
      .from('po_purchase_orders')
      .select('total_amount')
      .in('status', ['completed', 'received'])
      .eq('supplier_id', supplierId),
    supabase.from('fin_payments').select('amount').eq('direction', 'payment').eq('supplier_id', supplierId),
  ]);
  if (oErr) throwDbError(oErr, '统计供应商应付');
  if (pErr) throwDbError(pErr, '统计供应商已付');
  const orderTotal = round2((orders ?? []).reduce((s, r) => s + toNumber(r.total_amount as string), 0));
  const adjustment = (await supplierAdjustment([supplierId])).get(supplierId) ?? 0;
  const billed = round2(orderTotal + adjustment);
  const paid = round2((payments ?? []).reduce((s, r) => s + toNumber(r.amount as string), 0));
  return { billed, paid };
}

/**
 * 供应商应付调整（采购 V2）：
 *   − Σ(approved 退货总额) + Σ(蓝字冲回重入) − Σ(红字暂估冲销)
 * 红蓝字金额均为正数快照，字别决定方向；对账平衡：蓝 − 红 = 实际价 − 暂估价差。
 */
async function supplierAdjustment(supplierIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (supplierIds.length === 0) return map;
  const supabase = getSupabaseClient();
  const [{ data: returns, error: rErr }, { data: reversals, error: vErr }] = await Promise.all([
    supabase.from('po_returns').select('supplier_id, total_amount').eq('status', 'approved').in('supplier_id', supplierIds),
    supabase
      .from('po_receipts')
      .select('supplier_id, total_amount, reversal_kind')
      .eq('status', 'approved')
      .not('reversal_kind', 'is', null)
      .in('supplier_id', supplierIds),
  ]);
  if (rErr) throwDbError(rErr, '统计退货冲减');
  if (vErr) throwDbError(vErr, '统计冲回差额');
  for (const row of (returns ?? []) as unknown as Array<{ supplier_id: string; total_amount: string }>) {
    map.set(row.supplier_id, round2((map.get(row.supplier_id) ?? 0) - toNumber(row.total_amount)));
  }
  for (const row of (reversals ?? []) as unknown as Array<{ supplier_id: string; total_amount: string; reversal_kind: string }>) {
    const sign = row.reversal_kind === 'blue' ? 1 : -1;
    map.set(row.supplier_id, round2((map.get(row.supplier_id) ?? 0) + sign * toNumber(row.total_amount)));
  }
  return map;
}

// ---------------------------------------------------------------------------
// 收付款单：创建 / 删除 / 分页列表
// ---------------------------------------------------------------------------

/** 登记收款（receipt） */
export async function createReceipt(input: ReceiptCreateInput, operatorId: string): Promise<PaymentView> {
  const supabase = getSupabaseClient();

  const { data: customer, error: cErr } = await supabase
    .from('md_customers')
    .select('id, name')
    .eq('id', input.customer_id)
    .maybeSingle();
  if (cErr) throwDbError(cErr, '校验客户');
  if (!customer) throw new ApiError(400, 'FIN.CUSTOMER_NOT_FOUND', '客户不存在');

  // 关联订单（可选）：必须为该客户的已完成销售订单
  let orderNo: string | null = null;
  if (input.order_id) {
    const { data: order, error: oErr } = await supabase
      .from('so_sales_orders')
      .select('id, order_no, customer_id, status')
      .eq('id', input.order_id)
      .maybeSingle();
    if (oErr) throwDbError(oErr, '校验关联订单');
    if (!order || order.customer_id !== input.customer_id) {
      throw new ApiError(400, 'FIN.ORDER_MISMATCH', '关联订单不存在或不属于该客户');
    }
    if (order.status !== 'completed') {
      throw new ApiError(400, 'FIN.ORDER_NOT_COMPLETED', '只能关联已完成的销售订单');
    }
    orderNo = order.order_no as string;
  }

  // 超额拦截：累计收款 + 本次 <= 应收
  const { billed, received } = await sumCustomer(input.customer_id);
  const remaining = round2(billed - received);
  if (round2(received + input.amount) > billed + 0.001) {
    throw new ApiError(
      400,
      'FIN.OVER_AMOUNT',
      `收款金额超出该客户当前欠款（剩余 ¥${remaining.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}）`,
    );
  }

  return insertPayment('receipt', { ...input, order_no: orderNo }, operatorId);
}

/** 登记付款（payment） */
export async function createPayment(input: PaymentCreateInput, operatorId: string): Promise<PaymentView> {
  const supabase = getSupabaseClient();

  const { data: supplier, error: sErr } = await supabase
    .from('md_suppliers')
    .select('id, name')
    .eq('id', input.supplier_id)
    .maybeSingle();
  if (sErr) throwDbError(sErr, '校验供应商');
  if (!supplier) throw new ApiError(400, 'FIN.SUPPLIER_NOT_FOUND', '供应商不存在');

  let orderNo: string | null = null;
  if (input.order_id) {
    const { data: order, error: oErr } = await supabase
      .from('po_purchase_orders')
      .select('id, order_no, supplier_id, status')
      .eq('id', input.order_id)
      .maybeSingle();
    if (oErr) throwDbError(oErr, '校验关联订单');
    if (!order || order.supplier_id !== input.supplier_id) {
      throw new ApiError(400, 'FIN.ORDER_MISMATCH', '关联订单不存在或不属于该供应商');
    }
    if (!['completed', 'received'].includes(order.status as string)) {
      throw new ApiError(400, 'FIN.ORDER_NOT_COMPLETED', '只能关联已入库的采购订单');
    }
    orderNo = order.order_no as string;
  }

  const { billed, paid } = await sumSupplier(input.supplier_id);
  const remaining = round2(billed - paid);
  if (round2(paid + input.amount) > billed + 0.001) {
    throw new ApiError(
      400,
      'FIN.OVER_AMOUNT',
      `付款金额超出该供应商当前欠款（剩余 ¥${remaining.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}）`,
    );
  }

  return insertPayment('payment', { ...input, order_no: orderNo }, operatorId);
}

interface InsertInput {
  amount: number;
  method: (typeof PAYMENT_METHODS)[number];
  paid_at?: string;
  order_id?: string;
  order_no: string | null;
  remark?: string;
  customer_id?: string;
  supplier_id?: string;
}

async function insertPayment(direction: PaymentDirection, input: InsertInput, operatorId: string): Promise<PaymentView> {
  const supabase = getSupabaseClient();
  const paidAt = input.paid_at ?? new Date().toISOString().slice(0, 10);

  let row: FinPayment | null = null;
  for (let attempt = 0; attempt < 2 && !row; attempt += 1) {
    const docNo = await generateDocNo(direction);
    const { data, error } = await supabase
      .from('fin_payments')
      .insert({
        doc_no: docNo,
        direction,
        customer_id: direction === 'receipt' ? (input.customer_id ?? null) : null,
        supplier_id: direction === 'payment' ? (input.supplier_id ?? null) : null,
        order_id: input.order_id ?? null,
        order_no: input.order_no,
        amount: round2(input.amount),
        method: input.method,
        paid_at: paidAt,
        remark: emptyToNull(input.remark),
        created_by: operatorId,
      })
      .select('*')
      .single();
    if (error) {
      if (error.code === '23505' && attempt === 0) continue;
      throwDbError(error, direction === 'receipt' ? '登记收款' : '登记付款');
    }
    row = data as FinPayment;
  }
  if (!row) throw new ApiError(500, 'FIN.DB_ERROR', '保存收付款单失败');

  const partnerNames = await fetchNameMap(direction === 'receipt' ? 'md_customers' : 'md_suppliers', [
    direction === 'receipt' ? row.customer_id : row.supplier_id,
  ]);
  const creatorNames = await fetchNameMap('sys_users', [row.created_by]);
  return serialize(row, {
    partner: partnerNames.get((direction === 'receipt' ? row.customer_id : row.supplier_id) ?? ''),
    creator: row.created_by ? creatorNames.get(row.created_by) : null,
  });
}

/** 删除收付款单（欠款随之回升） */
export async function deletePayment(id: string, direction: PaymentDirection): Promise<void> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('fin_payments').select('id, direction').eq('id', id).maybeSingle();
  if (error) throwDbError(error, '查询收付款单');
  if (!data) throw new ApiError(404, 'FIN.NOT_FOUND', '收付款单不存在');
  if (data.direction !== direction) {
    throw new ApiError(400, 'FIN.DIRECTION_MISMATCH', '单据类型不匹配');
  }
  const { error: delErr } = await supabase.from('fin_payments').delete().eq('id', id);
  if (delErr) throwDbError(delErr, '删除收付款单');
}

/** 按往来单位名称/编码模糊匹配 ID（无关键字返回 null 表示不过滤） */
async function matchPartnerIds(direction: PaymentDirection | undefined, keyword: string): Promise<string[] | null> {
  const kw = escapeOrKeyword(keyword);
  if (!kw) return null;
  const supabase = getSupabaseClient();
  const ids: string[] = [];
  // 关键字同时匹配客户与供应商（流水页可能混合两种方向）
  if (!direction || direction === 'receipt') {
    const { data } = await supabase.from('md_customers').select('id').or(`name.ilike.%${kw}%,code.ilike.%${kw}%`);
    ids.push(...((data ?? []).map((r) => r.id as string)));
  }
  if (!direction || direction === 'payment') {
    const { data } = await supabase.from('md_suppliers').select('id').or(`name.ilike.%${kw}%,code.ilike.%${kw}%`);
    ids.push(...((data ?? []).map((r) => r.id as string)));
  }
  return ids;
}

export interface PaymentListQuery extends ListQuery {
  direction?: PaymentDirection;
}

/** 收付款流水分页（按创建时间倒序；keyword 搜单号/关联单号/往来单位） */
export async function listPayments(query: PaymentListQuery): Promise<PagedResult<PaymentView>> {
  const supabase = getSupabaseClient();
  const from = (query.page - 1) * query.pageSize;

  const partnerIds = await matchPartnerIds(query.direction, query.keyword);
  if (query.keyword && partnerIds && partnerIds.length === 0) {
    // 关键字无匹配往来单位时仍可能命中单号，不能直接返回空（继续走 or 条件）
  }

  let builder = supabase
    .from('fin_payments')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false });

  if (query.direction) builder = builder.eq('direction', query.direction);
  if (query.keyword) {
    const kw = escapeOrKeyword(query.keyword);
    const parts = [`doc_no.ilike.%${kw}%`, `order_no.ilike.%${kw}%`];
    if (partnerIds && partnerIds.length > 0) {
      const col = query.direction === 'payment' ? 'supplier_id' : 'customer_id';
      if (!query.direction) {
        parts.push(`customer_id.in.(${partnerIds.join(',')})`, `supplier_id.in.(${partnerIds.join(',')})`);
      } else {
        parts.push(`${col}.in.(${partnerIds.join(',')})`);
      }
    }
    builder = builder.or(parts.join(','));
  }

  const { data, error, count } = await builder.range(from, from + query.pageSize - 1);
  if (error) throwDbError(error, '查询收付款流水');

  const rows = (data ?? []) as FinPayment[];
  const customerNames = await fetchNameMap('md_customers', rows.map((r) => r.customer_id));
  const supplierNames = await fetchNameMap('md_suppliers', rows.map((r) => r.supplier_id));
  const creatorNames = await fetchNameMap('sys_users', rows.map((r) => r.created_by));

  return {
    items: rows.map((row) =>
      serialize(row, {
        partner:
          row.direction === 'receipt'
            ? customerNames.get(row.customer_id ?? '')
            : supplierNames.get(row.supplier_id ?? ''),
        creator: row.created_by ? creatorNames.get(row.created_by) : null,
      }),
    ),
    total: count ?? 0,
    page: query.page,
    page_size: query.pageSize,
  };
}

// ---------------------------------------------------------------------------
// 应收 / 应付欠款聚合（分页按往来单位，页内聚合订单与收付款）
// ---------------------------------------------------------------------------

interface PartnerPageRow {
  id: string;
  code: string;
  name: string;
  contact: string | null;
  phone: string | null;
}

async function pagedPartners(
  table: 'md_customers' | 'md_suppliers',
  query: ListQuery,
): Promise<{ rows: PartnerPageRow[]; total: number }> {
  const from = (query.page - 1) * query.pageSize;
  let builder = getSupabaseClient()
    .from(table)
    .select('id, code, name, contact, phone', { count: 'exact' })
    .order('created_at', { ascending: false });
  if (query.keyword) {
    const kw = escapeOrKeyword(query.keyword);
    if (kw) builder = builder.or(`name.ilike.%${kw}%,code.ilike.%${kw}%`);
  }
  const { data, error, count } = await builder.range(from, from + query.pageSize - 1);
  if (error) throwDbError(error, '查询往来单位');
  return { rows: (data ?? []) as unknown as PartnerPageRow[], total: count ?? 0 };
}

/** 批量聚合：completed 订单总额 + 收付款合计（按 partner 维度） */
async function aggregateByPartners(
  direction: PaymentDirection,
  partnerIds: string[],
): Promise<{ billed: Map<string, number>; settled: Map<string, number> }> {
  const billed = new Map<string, number>();
  const settled = new Map<string, number>();
  if (partnerIds.length === 0) return { billed, settled };
  const supabase = getSupabaseClient();
  const partnerCol = direction === 'receipt' ? 'customer_id' : 'supplier_id';
  const orderTable = direction === 'receipt' ? 'so_sales_orders' : 'po_purchase_orders';
  // 采购 V2：订单"已入库(received)"计入应付；completed 为历史数据兼容值
  const orderStatuses = direction === 'receipt' ? ['completed'] : ['completed', 'received'];

  const [{ data: orders, error: oErr }, { data: payments, error: pErr }] = await Promise.all([
    supabase.from(orderTable).select(`${partnerCol}, total_amount`).in('status', orderStatuses).in(partnerCol, partnerIds),
    supabase.from('fin_payments').select(`${partnerCol}, amount`).eq('direction', direction).in(partnerCol, partnerIds),
  ]);
  if (oErr) throwDbError(oErr, '聚合订单金额');
  if (pErr) throwDbError(pErr, '聚合收付款');

  for (const row of (orders ?? []) as unknown as Array<Record<string, unknown>>) {
    const key = row[partnerCol] as string;
    billed.set(key, round2((billed.get(key) ?? 0) + toNumber(row.total_amount as string)));
  }
  // 采购 V2：应付 = 订单已入库总额 − 退货 + 蓝字冲回 − 红字暂估
  if (direction === 'payment') {
    const adjustments = await supplierAdjustment(partnerIds);
    for (const [supplierId, delta] of adjustments) {
      billed.set(supplierId, round2((billed.get(supplierId) ?? 0) + delta));
    }
  }
  for (const row of (payments ?? []) as unknown as Array<Record<string, unknown>>) {
    const key = row[partnerCol] as string;
    settled.set(key, round2((settled.get(key) ?? 0) + toNumber(row.amount as string)));
  }
  return { billed, settled };
}

/** 应收欠款（按客户聚合，分页） */
export async function listReceivables(query: ListQuery): Promise<PagedResult<ReceivableRow>> {
  const { rows, total } = await pagedPartners('md_customers', query);
  const { billed, settled } = await aggregateByPartners('receipt', rows.map((r) => r.id));
  return {
    items: rows.map((row) => {
      const b = billed.get(row.id) ?? 0;
      const r = settled.get(row.id) ?? 0;
      return {
        customer_id: row.id,
        code: row.code,
        name: row.name,
        contact: row.contact,
        phone: row.phone,
        billed: b,
        received: r,
        outstanding: round2(b - r),
      };
    }),
    total,
    page: query.page,
    page_size: query.pageSize,
  };
}

/** 应付欠款（按供应商聚合，分页） */
export async function listPayables(query: ListQuery): Promise<PagedResult<PayableRow>> {
  const { rows, total } = await pagedPartners('md_suppliers', query);
  const { billed, settled } = await aggregateByPartners('payment', rows.map((r) => r.id));
  return {
    items: rows.map((row) => {
      const b = billed.get(row.id) ?? 0;
      const p = settled.get(row.id) ?? 0;
      return {
        supplier_id: row.id,
        code: row.code,
        name: row.name,
        contact: row.contact,
        phone: row.phone,
        billed: b,
        paid: p,
        outstanding: round2(b - p),
      };
    }),
    total,
    page: query.page,
    page_size: query.pageSize,
  };
}

/** 仪表盘汇总：全局应收/应付欠款合计（>0 部分） */
export async function financeSummary(): Promise<{ receivable_outstanding: number; payable_outstanding: number }> {
  const supabase = getSupabaseClient();
  const [{ data: soRows, error: soErr }, { data: rcRows, error: rcErr }, { data: poRows, error: poErr }, { data: pyRows, error: pyErr }] =
    await Promise.all([
      supabase.from('so_sales_orders').select('total_amount').eq('status', 'completed'),
      supabase.from('fin_payments').select('amount').eq('direction', 'receipt'),
      supabase.from('po_purchase_orders').select('total_amount').in('status', ['completed', 'received']),
      supabase.from('fin_payments').select('amount').eq('direction', 'payment'),
    ]);
  if (soErr || rcErr || poErr || pyErr) {
    throwDbError(soErr ?? rcErr ?? poErr ?? pyErr ?? { message: 'unknown' }, '统计财务汇总');
  }
  const sum = (rows: Array<Record<string, unknown>>, col: string) =>
    (rows ?? []).reduce((s, r) => s + toNumber(r[col] as string), 0);
  // 采购 V2：应付另计入退货/冲回调整（全局）
  const { data: retRows, error: retErr } = await supabase.from('po_returns').select('total_amount').eq('status', 'approved');
  const { data: revRows, error: revErr } = await supabase
    .from('po_receipts')
    .select('total_amount, reversal_kind')
    .eq('status', 'approved')
    .not('reversal_kind', 'is', null);
  if (retErr || revErr) throwDbError(retErr ?? revErr ?? { message: 'unknown' }, '统计退货冲回');
  const returnTotal = sum((retRows ?? []) as Array<Record<string, unknown>>, 'total_amount');
  const reversalNet = ((revRows ?? []) as unknown as Array<{ total_amount: string; reversal_kind: string }>).reduce(
    (s, r) => s + (r.reversal_kind === 'blue' ? 1 : -1) * toNumber(r.total_amount),
    0,
  );
  const receivable = round2(sum((soRows ?? []) as Array<Record<string, unknown>>, 'total_amount') - sum((rcRows ?? []) as Array<Record<string, unknown>>, 'amount'));
  const payable = round2(
    sum((poRows ?? []) as Array<Record<string, unknown>>, 'total_amount') +
      reversalNet -
      returnTotal -
      sum((pyRows ?? []) as Array<Record<string, unknown>>, 'amount'),
  );
  return {
    receivable_outstanding: Math.max(0, receivable),
    payable_outstanding: Math.max(0, payable),
  };
}
