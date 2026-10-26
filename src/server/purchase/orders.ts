/**
 * 采购订单服务端逻辑（po_*，采购 V2）
 *
 * 状态机：draft → pending → approved → received（到货入库，自动生成入库单 GR）
 *                ↘ rejected（可编辑后重新提交）| draft/pending/rejected → closed（关闭）
 * 仅 draft/rejected 可编辑、仅 draft 可删除；金额一律由服务端按明细行计算。
 * 审批走通用引擎（approval.ts）；到货入库强一致由数据库函数 po_fulfill_order 单事务保证。
 *
 * 历史兼容：confirmed/completed/cancelled 已在 0006 迁移映射为 approved/received/closed。
 *
 * 注意：Supabase SDK 无多语句事务，"订单头+明细"写入采用补偿模式
 * （明细失败则删除订单头），MVP 规模可接受；后续迁移存储过程或 Edge Function。
 */
import { z } from 'zod';
import { ApiError } from '@/server/http';
import { throwInventoryRpcError } from '@/server/inventory/shared';
import { emptyToNull, escapeOrKeyword, throwDbError, type ListQuery, type PagedResult } from '@/server/master-data/helpers';
import { approveCurrentStep, rejectCurrentStep, submitDocument } from '@/server/purchase/approval';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import type { PoPurchaseOrder, PoPurchaseOrderItem, SysUser } from '@/storage/database/shared/schema';

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export interface PurchaseOrderItemView {
  id: string;
  product_id: string;
  product_name: string | null;
  product_sku: string | null;
  product_spec: string | null;
  quantity: number;
  unit_price: number;
  amount: number;
  unit: string | null;
}

export interface PurchaseOrderView {
  id: string;
  order_no: string;
  supplier_id: string;
  supplier_name: string | null;
  status: string;
  order_date: string;
  total_amount: number;
  item_count: number;
  remark: string | null;
  created_by_name: string | null;
  confirmed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
  /** 来源申请单（可空） */
  requisition_id: string | null;
  requisition_no: string | null;
  approval_level: number | null;
  current_step: number;
  submitted_at: string | null;
  approved_by_name: string | null;
  approved_at: string | null;
  reject_reason: string | null;
  items?: PurchaseOrderItemView[];
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

export const orderUpsertSchema = z.object({
  supplier_id: uuid,
  order_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 YYYY-MM-DD')
    .optional(),
  remark: z.string().max(500, '备注不能超过 500 字').optional(),
  /** 来源采购申请单（申请单转入时携带） */
  requisition_id: uuid.optional(),
  items: z.array(itemSchema).min(1, '至少需要一行明细').max(200, '明细行过多'),
});
export type OrderUpsertInput = z.infer<typeof orderUpsertSchema>;

const ORDER_STATUSES = ['draft', 'pending', 'approved', 'rejected', 'received', 'closed'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

// ---------------------------------------------------------------------------
// 序列化
// ---------------------------------------------------------------------------

function toNumber(value: string | number | null): number {
  return value === null ? 0 : Number(value);
}

function serialize(
  row: PoPurchaseOrder,
  extra: {
    supplierName?: string | null;
    creatorName?: string | null;
    itemCount?: number;
    items?: PurchaseOrderItemView[];
    requisitionNo?: string | null;
    approverName?: string | null;
  } = {},
): PurchaseOrderView {
  return {
    id: row.id,
    order_no: row.order_no,
    supplier_id: row.supplier_id,
    supplier_name: extra.supplierName ?? null,
    status: row.status,
    order_date: row.order_date,
    total_amount: toNumber(row.total_amount),
    item_count: extra.itemCount ?? 0,
    remark: row.remark,
    created_by_name: extra.creatorName ?? null,
    confirmed_at: row.confirmed_at ? new Date(row.confirmed_at).toISOString() : null,
    cancelled_at: row.cancelled_at ? new Date(row.cancelled_at).toISOString() : null,
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString(),
    requisition_id: row.requisition_id,
    requisition_no: extra.requisitionNo ?? null,
    approval_level: row.approval_level,
    current_step: row.current_step,
    submitted_at: row.submitted_at ? new Date(row.submitted_at).toISOString() : null,
    approved_by_name: extra.approverName ?? null,
    approved_at: row.approved_at ? new Date(row.approved_at).toISOString() : null,
    reject_reason: row.reject_reason,
    items: extra.items,
  };
}

// ---------------------------------------------------------------------------
// 辅助：批量补全关联名称（避免 N+1）
// ---------------------------------------------------------------------------

async function fetchNameMap(table: 'md_suppliers' | 'md_products' | 'sys_users', ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (ids.length === 0) return map;
  const supabase = getSupabaseClient();
  const field = table === 'md_products' ? 'name' : table === 'md_suppliers' ? 'name' : 'display_name';
  const { data, error } = await supabase.from(table).select(`id, ${field}`).in('id', [...new Set(ids)]);
  if (error || !data) return map;
  for (const row of data as unknown as Array<{ id: string; [k: string]: string }>) {
    map.set(row.id, row[field]);
  }
  return map;
}

/** 生成采购单号 POyyyymmdd-NNNN（唯一约束冲突时由调用方重试） */
async function generateOrderNo(): Promise<string> {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const prefix = `PO${y}${m}${d}`;
  const supabase = getSupabaseClient();
  const { count, error } = await supabase
    .from('po_purchase_orders')
    .select('id', { count: 'exact', head: true })
    .like('order_no', `${prefix}%`);
  if (error) throwDbError(error, '生成采购单号');
  return `${prefix}-${String((count ?? 0) + 1).padStart(4, '0')}`;
}

interface PreparedItem {
  product_id: string;
  quantity: number;
  unit_price: number;
  amount: number;
  unit: string | null;
}

/** 校验供应商与商品存在性，计算行金额与总额 */
async function prepareItems(input: OrderUpsertInput): Promise<{ items: PreparedItem[]; total: number }> {
  const supabase = getSupabaseClient();

  const { data: supplier, error: supplierErr } = await supabase
    .from('md_suppliers')
    .select('id, status')
    .eq('id', input.supplier_id)
    .maybeSingle();
  if (supplierErr) throwDbError(supplierErr, '校验供应商');
  if (!supplier) throw new ApiError(400, 'PO.SUPPLIER_NOT_FOUND', '供应商不存在');
  if (supplier.status !== 'active') throw new ApiError(400, 'PO.SUPPLIER_DISABLED', '该供应商已停用，不能下单');

  const productIds = [...new Set(input.items.map((item) => item.product_id))];
  const { data: products, error: productErr } = await supabase
    .from('md_products')
    .select('id, unit, status')
    .in('id', productIds);
  if (productErr) throwDbError(productErr, '校验商品');
  const productMap = new Map((products ?? []).map((p) => [p.id as string, p]));
  for (const pid of productIds) {
    if (!productMap.has(pid)) throw new ApiError(400, 'PO.PRODUCT_NOT_FOUND', '存在无效商品，请刷新后重试');
  }

  let total = 0;
  const items: PreparedItem[] = input.items.map((item) => {
    const amount = Math.round(item.quantity * item.unit_price * 100) / 100;
    total = Math.round((total + amount) * 100) / 100;
    return {
      product_id: item.product_id,
      quantity: item.quantity,
      unit_price: item.unit_price,
      amount,
      unit: (productMap.get(item.product_id)?.unit as string | null) ?? null,
    };
  });
  return { items, total };
}

// ---------------------------------------------------------------------------
// 查询
// ---------------------------------------------------------------------------

export async function listOrders(query: ListQuery & { status?: string }): Promise<PagedResult<PurchaseOrderView>> {
  const supabase = getSupabaseClient();
  let builder = supabase
    .from('po_purchase_orders')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false });

  if (query.status && (ORDER_STATUSES as readonly string[]).includes(query.status)) {
    builder = builder.eq('status', query.status);
  }
  if (query.keyword) {
    const kw = escapeOrKeyword(query.keyword);
    if (kw) builder = builder.or(`order_no.ilike.%${kw}%,remark.ilike.%${kw}%`);
  }

  const from = (query.page - 1) * query.pageSize;
  const { data, error, count } = await builder.range(from, from + query.pageSize - 1);
  if (error) throwDbError(error, '查询采购订单');

  const rows = (data ?? []) as PoPurchaseOrder[];
  const supplierNames = await fetchNameMap('md_suppliers', rows.map((r) => r.supplier_id));
  const creatorNames = await fetchNameMap('sys_users', rows.map((r) => r.created_by).filter((v): v is string => !!v));

  // 明细行数（本页订单）
  const orderIds = rows.map((r) => r.id);
  const itemCounts = new Map<string, number>();
  if (orderIds.length > 0) {
    const { data: itemRows } = await supabase
      .from('po_purchase_order_items')
      .select('order_id')
      .in('order_id', orderIds);
    for (const item of (itemRows ?? []) as Array<{ order_id: string }>) {
      itemCounts.set(item.order_id, (itemCounts.get(item.order_id) ?? 0) + 1);
    }
  }

  return {
    items: rows.map((row) =>
      serialize(row, {
        supplierName: supplierNames.get(row.supplier_id),
        creatorName: row.created_by ? creatorNames.get(row.created_by) : null,
        itemCount: itemCounts.get(row.id) ?? 0,
      }),
    ),
    total: count ?? 0,
    page: query.page,
    page_size: query.pageSize,
  };
}

export async function getOrder(id: string): Promise<PurchaseOrderView> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('po_purchase_orders').select('*').eq('id', id).maybeSingle();
  if (error) throwDbError(error, '查询采购订单');
  if (!data) throw new ApiError(404, 'PO.NOT_FOUND', '采购订单不存在');
  const row = data as PoPurchaseOrder;

  const { data: itemRows, error: itemErr } = await supabase
    .from('po_purchase_order_items')
    .select('*')
    .eq('order_id', id)
    .order('created_at', { ascending: true });
  if (itemErr) throwDbError(itemErr, '查询订单明细');
  const items = (itemRows ?? []) as PoPurchaseOrderItem[];

  const productNames = await fetchNameMap('md_products', items.map((i) => i.product_id));
  const productExtra = new Map<string, { sku: string | null; spec: string | null }>();
  if (items.length > 0) {
    const { data: products } = await supabase
      .from('md_products')
      .select('id, sku_code, spec')
      .in('id', [...new Set(items.map((i) => i.product_id))]);
    for (const p of products ?? []) {
      productExtra.set(p.id as string, { sku: p.sku_code as string, spec: (p.spec as string | null) ?? null });
    }
  }

  const supplierNames = await fetchNameMap('md_suppliers', [row.supplier_id]);
  const creatorNames = row.created_by ? await fetchNameMap('sys_users', [row.created_by]) : new Map<string, string>();
  const approverNames = row.approved_by ? await fetchNameMap('sys_users', [row.approved_by]) : new Map<string, string>();

  // 来源申请单号（若有）
  let requisitionNo: string | null = null;
  if (row.requisition_id) {
    const { data: req } = await supabase
      .from('po_requisitions')
      .select('req_no')
      .eq('id', row.requisition_id)
      .maybeSingle();
    requisitionNo = (req?.req_no as string | undefined) ?? null;
  }

  const itemViews: PurchaseOrderItemView[] = items.map((item) => ({
    id: item.id,
    product_id: item.product_id,
    product_name: productNames.get(item.product_id) ?? null,
    product_sku: productExtra.get(item.product_id)?.sku ?? null,
    product_spec: productExtra.get(item.product_id)?.spec ?? null,
    quantity: toNumber(item.quantity),
    unit_price: toNumber(item.unit_price),
    amount: toNumber(item.amount),
    unit: item.unit,
  }));

  return serialize(row, {
    supplierName: supplierNames.get(row.supplier_id),
    creatorName: row.created_by ? creatorNames.get(row.created_by) : null,
    itemCount: itemViews.length,
    items: itemViews,
    requisitionNo,
    approverName: row.approved_by ? approverNames.get(row.approved_by) : null,
  });
}

// ---------------------------------------------------------------------------
// 写入
// ---------------------------------------------------------------------------

export async function createOrder(input: OrderUpsertInput, operatorId: string): Promise<PurchaseOrderView> {
  const supabase = getSupabaseClient();
  const { items, total } = await prepareItems(input);
  const orderDate = input.order_date ?? new Date().toISOString().slice(0, 10);
  const remark = emptyToNull(input.remark);

  // 单号唯一冲突时重试一次（并发兜底）
  let order: PoPurchaseOrder | null = null;
  for (let attempt = 0; attempt < 2 && !order; attempt += 1) {
    const orderNo = await generateOrderNo();
    const { data, error } = await supabase
      .from('po_purchase_orders')
      .insert({
        order_no: orderNo,
        supplier_id: input.supplier_id,
        order_date: orderDate,
        total_amount: total,
        remark,
        requisition_id: input.requisition_id ?? null,
        created_by: operatorId,
        status: 'draft',
      })
      .select('*')
      .single();
    if (error) {
      if (error.code === '23505' && attempt === 0) continue;
      throwDbError(error, '创建采购订单');
    }
    order = data as PoPurchaseOrder;
  }
  if (!order) throw new ApiError(500, 'PO.DB_ERROR', '创建采购订单失败');

  const { error: itemErr } = await supabase
    .from('po_purchase_order_items')
    .insert(items.map((item) => ({ ...item, order_id: order.id })));
  if (itemErr) {
    // 补偿：删除订单头（明细随级联为空）
    await supabase.from('po_purchase_orders').delete().eq('id', order.id);
    throwDbError(itemErr, '保存订单明细');
  }
  return getOrder(order.id);
}

export async function updateOrder(id: string, input: OrderUpsertInput): Promise<PurchaseOrderView> {
  const supabase = getSupabaseClient();
  const existing = await getOrder(id);
  if (existing.status !== 'draft' && existing.status !== 'rejected') {
    throw new ApiError(400, 'PO.NOT_DRAFT', '只有草稿或已驳回状态的订单可以编辑');
  }
  const { items, total } = await prepareItems(input);

  const { error } = await supabase
    .from('po_purchase_orders')
    .update({
      supplier_id: input.supplier_id,
      order_date: input.order_date ?? existing.order_date,
      remark: emptyToNull(input.remark),
      total_amount: total,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) throwDbError(error, '更新采购订单');

  // 明细整组替换
  const { error: delErr } = await supabase.from('po_purchase_order_items').delete().eq('order_id', id);
  if (delErr) throwDbError(delErr, '更新订单明细');
  const { error: insErr } = await supabase
    .from('po_purchase_order_items')
    .insert(items.map((item) => ({ ...item, order_id: id })));
  if (insErr) throwDbError(insErr, '更新订单明细');

  return getOrder(id);
}

export async function deleteOrder(id: string): Promise<void> {
  const supabase = getSupabaseClient();
  const existing = await getOrder(id);
  if (existing.status !== 'draft') {
    throw new ApiError(400, 'PO.NOT_DRAFT', '只有草稿状态的订单可以删除');
  }
  const { error } = await supabase.from('po_purchase_orders').delete().eq('id', id);
  if (error) throwDbError(error, '删除采购订单');
}

/** 提交审批：draft/rejected → pending（审批引擎生成步骤实例） */
export async function submitOrder(id: string, user: SysUser): Promise<PurchaseOrderView> {
  const existing = await getOrder(id);
  await submitDocument('order', id, existing.total_amount, user);
  return getOrder(id);
}

/** 审批通过当前步（终审后 → approved） */
export async function approveOrder(id: string, user: SysUser, comment?: string): Promise<PurchaseOrderView> {
  await approveCurrentStep('order', id, user, comment);
  return getOrder(id);
}

/** 驳回当前步（→ rejected） */
export async function rejectOrder(id: string, user: SysUser, reason: string): Promise<PurchaseOrderView> {
  await rejectCurrentStep('order', id, user, reason);
  return getOrder(id);
}

/** 关闭订单：draft/pending/rejected → closed */
export async function cancelOrder(id: string): Promise<PurchaseOrderView> {
  const supabase = getSupabaseClient();
  const existing = await getOrder(id);
  if (!['draft', 'pending', 'rejected'].includes(existing.status)) {
    throw new ApiError(400, 'PO.BAD_TRANSITION', '当前状态不允许关闭');
  }
  const { error } = await supabase
    .from('po_purchase_orders')
    .update({ status: 'closed', cancelled_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throwDbError(error, '关闭采购订单');
  return getOrder(id);
}

/**
 * 到货完成：approved → received 并整单入库（自动生成一张正式入库单 GR）。
 * 强一致由数据库函数 po_fulfill_order 单事务保证（含移动加权成本）。
 */
export async function completeOrder(id: string, operatorId: string): Promise<PurchaseOrderView> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.rpc('po_fulfill_order', {
    p_order_id: id,
    p_user_id: operatorId,
  });
  if (error) throwInventoryRpcError(error, '采购到货');
  return getOrder(id);
}
