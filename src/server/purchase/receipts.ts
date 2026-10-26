/**
 * 采购入库单服务端逻辑（po_receipts / po_receipt_items）
 *
 * 状态机：draft → pending → approved(已入库) → reversed(已冲回)
 *                      ↘ rejected | draft/pending → closed
 * - 终审通过由 po_execute_receipt 单事务完成：状态 + 库存（移动加权成本）+ 流水。
 * - 暂估入库（is_estimated，发票未到）；来票后 reverse 红蓝冲回（po_reverse_receipt 单事务）：
 *   红字按暂估价出库回冲、蓝字按发票价重入库，原单置 reversed。
 * - 冲回净差（蓝 − 红）由财务模块计入供应商应付调整。
 */
import { z } from 'zod';
import { nextDocNo } from '@/server/doc-no';
import { ApiError } from '@/server/http';
import { throwInventoryRpcError } from '@/server/inventory/shared';
import { emptyToNull, escapeOrKeyword, throwDbError, type ListQuery, type PagedResult } from '@/server/master-data/helpers';
import { approveCurrentStep, listSteps, rejectCurrentStep, submitDocument, type ApprovalStepView } from '@/server/approval/engine';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import type { PoPurchaseOrderItem, PoReceipt, PoReceiptItem, SysUser } from '@/storage/database/shared/schema';

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export interface ReceiptItemView {
  id: string;
  product_id: string;
  product_name: string | null;
  product_sku: string | null;
  quantity: number;
  unit_price: number;
  amount: number;
  unit: string | null;
}

export interface ReceiptView {
  id: string;
  receipt_no: string;
  order_id: string;
  order_no: string | null;
  supplier_id: string;
  supplier_name: string | null;
  status: string;
  is_estimated: boolean;
  invoice_no: string | null;
  reversal_of_id: string | null;
  reversal_kind: string | null;
  total_amount: number;
  receive_date: string;
  item_count: number;
  approval_level: number | null;
  current_step: number;
  reject_reason: string | null;
  remark: string | null;
  created_by_name: string | null;
  created_at: string;
  items?: ReceiptItemView[];
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

export const receiptCreateSchema = z.object({
  order_id: uuid,
  receive_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 YYYY-MM-DD')
    .optional(),
  is_estimated: z.boolean().default(false),
  remark: z.string().max(500, '备注不能超过 500 字').optional(),
  items: z.array(itemSchema).min(1, '至少需要一行明细').max(200, '明细行过多'),
});
export type ReceiptCreateInput = z.infer<typeof receiptCreateSchema>;

export const receiptReverseSchema = z.object({
  invoice_no: z.string().min(1, '请填写发票号').max(64, '发票号过长'),
  items: z.array(itemSchema).min(1, '至少需要一行明细').max(200, '明细行过多'),
});
export type ReceiptReverseInput = z.infer<typeof receiptReverseSchema>;

export const RECEIPT_STATUSES = ['draft', 'pending', 'approved', 'rejected', 'reversed', 'closed'] as const;

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

async function fetchOrderNoMap(ids: (string | null)[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const uniq = [...new Set(ids.filter((v): v is string => Boolean(v)))];
  if (uniq.length === 0) return map;
  const { data } = await getSupabaseClient().from('po_purchase_orders').select('id, order_no').in('id', uniq);
  for (const row of data ?? []) map.set(row.id as string, row.order_no as string);
  return map;
}

function serialize(row: PoReceipt, extra: Partial<ReceiptView> = {}): ReceiptView {
  return {
    id: row.id,
    receipt_no: row.receipt_no,
    order_id: row.order_id,
    order_no: extra.order_no ?? null,
    supplier_id: row.supplier_id,
    supplier_name: extra.supplier_name ?? null,
    status: row.status,
    is_estimated: row.is_estimated,
    invoice_no: row.invoice_no,
    reversal_of_id: row.reversal_of_id,
    reversal_kind: row.reversal_kind,
    total_amount: toNumber(row.total_amount),
    receive_date: row.receive_date,
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

/** 入库单号 GRyyyymmdd-NNNN（红蓝冲回单 GRR/GRB 由数据库函数生成） */
async function generateReceiptNo(): Promise<string> {
  return nextDocNo('GR', 'po_receipts', 'receipt_no');
}

// ---------------------------------------------------------------------------
// 查询
// ---------------------------------------------------------------------------

export async function listReceipts(
  query: ListQuery & { status?: string; estimated?: string },
): Promise<PagedResult<ReceiptView>> {
  const supabase = getSupabaseClient();
  let builder = supabase
    .from('po_receipts')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false });

  if (query.status && (RECEIPT_STATUSES as readonly string[]).includes(query.status)) {
    builder = builder.eq('status', query.status);
  }
  if (query.estimated === 'true') builder = builder.eq('is_estimated', true);
  if (query.keyword) {
    const kw = escapeOrKeyword(query.keyword);
    if (kw) builder = builder.or(`receipt_no.ilike.%${kw}%,invoice_no.ilike.%${kw}%`);
  }

  const from = (query.page - 1) * query.pageSize;
  const { data, error, count } = await builder.range(from, from + query.pageSize - 1);
  if (error) throwDbError(error, '查询采购入库单');

  const rows = (data ?? []) as PoReceipt[];
  const supplierNames = await fetchNameMap('md_suppliers', rows.map((r) => r.supplier_id));
  const orderNos = await fetchOrderNoMap(rows.map((r) => r.order_id));
  const creatorNames = await fetchNameMap('sys_users', rows.map((r) => r.created_by));

  const ids = rows.map((r) => r.id);
  const itemCounts = new Map<string, number>();
  if (ids.length > 0) {
    const { data: itemRows } = await supabase.from('po_receipt_items').select('receipt_id').in('receipt_id', ids);
    for (const item of (itemRows ?? []) as Array<{ receipt_id: string }>) {
      itemCounts.set(item.receipt_id, (itemCounts.get(item.receipt_id) ?? 0) + 1);
    }
  }

  return {
    items: rows.map((row) =>
      serialize(row, {
        order_no: orderNos.get(row.order_id),
        supplier_name: supplierNames.get(row.supplier_id),
        item_count: itemCounts.get(row.id) ?? 0,
        created_by_name: row.created_by ? creatorNames.get(row.created_by) : null,
      }),
    ),
    total: count ?? 0,
    page: query.page,
    page_size: query.pageSize,
  };
}

export async function getReceipt(id: string): Promise<ReceiptView> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('po_receipts').select('*').eq('id', id).maybeSingle();
  if (error) throwDbError(error, '查询采购入库单');
  if (!data) throw new ApiError(404, 'PO.NOT_FOUND', '采购入库单不存在');
  const row = data as PoReceipt;

  const { data: itemRows, error: itemErr } = await supabase
    .from('po_receipt_items')
    .select('*')
    .eq('receipt_id', id)
    .order('created_at', { ascending: true });
  if (itemErr) throwDbError(itemErr, '查询入库明细');
  const items = (itemRows ?? []) as PoReceiptItem[];

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
  const orderNos = await fetchOrderNoMap([row.order_id]);
  const creatorNames = await fetchNameMap('sys_users', [row.created_by]);
  const steps = await listSteps('receipt', id);

  const itemViews: ReceiptItemView[] = items.map((item) => ({
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
    order_no: orderNos.get(row.order_id),
    supplier_name: supplierNames.get(row.supplier_id),
    item_count: itemViews.length,
    created_by_name: row.created_by ? creatorNames.get(row.created_by) : null,
    items: itemViews,
    steps,
  });
}

// ---------------------------------------------------------------------------
// 写入
// ---------------------------------------------------------------------------

/**
 * 新建入库单（draft）：从已审采购订单生成（可改数量/单价，MVP 不做累计入库校验）。
 * 暂估入库 is_estimated=true 表示发票未到，按当前单价暂估入账。
 */
export async function createReceipt(input: ReceiptCreateInput, operatorId: string): Promise<ReceiptView> {
  const supabase = getSupabaseClient();

  const { data: order, error: oErr } = await supabase
    .from('po_purchase_orders')
    .select('id, order_no, supplier_id, status')
    .eq('id', input.order_id)
    .maybeSingle();
  if (oErr) throwDbError(oErr, '校验采购订单');
  if (!order) throw new ApiError(400, 'PO.ORDER_NOT_FOUND', '采购订单不存在');
  if (order.status !== 'approved' && order.status !== 'received') {
    throw new ApiError(400, 'PO.ORDER_NOT_APPROVED', '仅已审批的采购订单可生成入库单');
  }

  // 明细商品须属于订单明细（防止录入无关商品）
  const { data: orderItems, error: oiErr } = await supabase
    .from('po_purchase_order_items')
    .select('*')
    .eq('order_id', input.order_id);
  if (oiErr) throwDbError(oiErr, '校验订单明细');
  const orderProductIds = new Set(((orderItems ?? []) as PoPurchaseOrderItem[]).map((i) => i.product_id));

  let total = 0;
  const items = input.items.map((item) => {
    if (!orderProductIds.has(item.product_id)) {
      throw new ApiError(400, 'PO.PRODUCT_MISMATCH', '入库明细中存在订单之外的商品');
    }
    const amount = round2(item.quantity * item.unit_price);
    total = round2(total + amount);
    return { ...item, amount };
  });

  // 单位快照
  const productIds = [...new Set(items.map((i) => i.product_id))];
  const { data: products } = await supabase.from('md_products').select('id, unit').in('id', productIds);
  const unitMap = new Map((products ?? []).map((p) => [p.id as string, p.unit as string | null]));

  let row: PoReceipt | null = null;
  for (let attempt = 0; attempt < 2 && !row; attempt += 1) {
    const receiptNo = await generateReceiptNo();
    const { data, error } = await supabase
      .from('po_receipts')
      .insert({
        receipt_no: receiptNo,
        order_id: input.order_id,
        supplier_id: order.supplier_id as string,
        status: 'draft',
        is_estimated: input.is_estimated,
        total_amount: total,
        receive_date: input.receive_date ?? new Date().toISOString().slice(0, 10),
        remark: emptyToNull(input.remark),
        created_by: operatorId,
      })
      .select('*')
      .single();
    if (error) {
      if (error.code === '23505' && attempt === 0) continue;
      throwDbError(error, '创建采购入库单');
    }
    row = data as PoReceipt;
  }
  if (!row) throw new ApiError(500, 'PO.DB_ERROR', '创建采购入库单失败');

  const { error: itemErr } = await supabase.from('po_receipt_items').insert(
    items.map((item) => ({
      receipt_id: row.id,
      product_id: item.product_id,
      quantity: item.quantity,
      unit_price: item.unit_price,
      amount: item.amount,
      unit: unitMap.get(item.product_id) ?? null,
    })),
  );
  if (itemErr) {
    await supabase.from('po_receipts').delete().eq('id', row.id);
    throwDbError(itemErr, '保存入库明细');
  }
  return getReceipt(row.id);
}

export async function deleteReceipt(id: string): Promise<void> {
  const supabase = getSupabaseClient();
  const existing = await getReceipt(id);
  if (existing.status !== 'draft') {
    throw new ApiError(400, 'PO.NOT_DRAFT', '只有草稿状态的入库单可以删除');
  }
  const { error } = await supabase.from('po_receipts').delete().eq('id', id);
  if (error) throwDbError(error, '删除采购入库单');
}

/** 关闭入库单：draft/pending/rejected → closed */
export async function closeReceipt(id: string): Promise<ReceiptView> {
  const supabase = getSupabaseClient();
  const existing = await getReceipt(id);
  if (!['draft', 'pending', 'rejected'].includes(existing.status)) {
    throw new ApiError(400, 'PO.BAD_TRANSITION', '当前状态不允许关闭');
  }
  const { error } = await supabase
    .from('po_receipts')
    .update({ status: 'closed', updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throwDbError(error, '关闭入库单');
  return getReceipt(id);
}

export async function submitReceipt(id: string, user: SysUser): Promise<ReceiptView> {
  const existing = await getReceipt(id);
  await submitDocument('receipt', id, existing.total_amount, user);
  return getReceipt(id);
}

/** 审核通过（终审由 po_execute_receipt 完成入库 + 成本 + 流水） */
export async function approveReceipt(id: string, user: SysUser, comment?: string): Promise<ReceiptView> {
  await approveCurrentStep('receipt', id, user, comment);
  return getReceipt(id);
}

export async function rejectReceipt(id: string, user: SysUser, reason: string): Promise<ReceiptView> {
  await rejectCurrentStep('receipt', id, user, reason);
  return getReceipt(id);
}

/**
 * 暂估冲回：来票后对暂估入库单做红蓝字冲回。
 * 红字按原暂估价出库回冲，蓝字按发票价重新入库，原单置 reversed。
 * 蓝字明细商品集合必须与原单一致（数量/单价按发票实际）。
 */
export async function reverseReceipt(id: string, input: ReceiptReverseInput, user: SysUser): Promise<ReceiptView> {
  const existing = await getReceipt(id);
  if (existing.status !== 'approved' || !existing.is_estimated) {
    throw new ApiError(400, 'PO.BAD_TRANSITION', '仅已入库的暂估单可执行冲回');
  }

  // 蓝字明细校验：商品集合与原单一致
  const originalIds = new Set((existing.items ?? []).map((i) => i.product_id));
  const inputIds = new Set(input.items.map((i) => i.product_id));
  if (originalIds.size !== inputIds.size || [...originalIds].some((pid) => !inputIds.has(pid))) {
    throw new ApiError(400, 'PO.ITEMS_MISMATCH', '蓝字明细商品须与原暂估单一致');
  }

  const supabase = getSupabaseClient();
  const { error } = await supabase.rpc('po_reverse_receipt', {
    p_receipt_id: id,
    p_invoice_no: input.invoice_no,
    p_items: input.items,
    p_user_id: user.id,
  });
  if (error) throwInventoryRpcError(error, '暂估冲回');
  return getReceipt(id);
}
