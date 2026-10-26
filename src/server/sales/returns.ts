/**
 * 销售退货单服务端逻辑（so_returns / so_return_items）
 *
 * 链路：退货单(draft) → 提交(pending) → 审批 → 终审通过由数据库函数
 *       so_execute_return 单事务完成：退货量校验（≤ 订单已出库量 − 已退量）+
 *       按退货明细快照成本单价红字回补库存（移动加权重算）。
 *
 * 应收联动：fin 应收汇总口径 = Σ(shipped 订单总额) − Σ(approved 退货总额) − Σ(收款)。
 */
import { z } from 'zod';
import { approveCurrentStep, listSteps, rejectCurrentStep, submitDocument, type ApprovalStepView } from '@/server/approval/engine';
import { nextDocNo } from '@/server/doc-no';
import { ApiError } from '@/server/http';
import { emptyToNull, escapeOrKeyword, throwDbError, type ListQuery, type PagedResult } from '@/server/master-data/helpers';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import type { SoReturn, SoReturnItem, SysUser } from '@/storage/database/shared/schema';

export interface ReturnItemView {
  id: string;
  product_id: string;
  product_name: string | null;
  product_sku: string | null;
  quantity: number;
  unit_price: number;
  amount: number;
  unit_cost: number | null;
  unit: string | null;
}

export interface ReturnView {
  id: string;
  return_no: string;
  order_id: string;
  order_no: string | null;
  shipment_id: string | null;
  shipment_no: string | null;
  customer_id: string;
  customer_name: string | null;
  status: string;
  return_date: string;
  reason: string | null;
  total_amount: number;
  approval_level: number | null;
  current_step: number;
  submitted_at: string | null;
  approved_at: string | null;
  reject_reason: string | null;
  remark: string | null;
  /** 退回入库仓库（可空，空=默认仓 WH01） */
  warehouse_id: string | null;
  created_by_name: string | null;
  created_at: string;
  items?: ReturnItemView[];
  steps?: ApprovalStepView[];
}

const uuid = z.string().regex(/^[0-9a-fA-F-]{36}$/, 'ID 格式不正确');

const itemSchema = z.object({
  product_id: uuid,
  quantity: z.number().positive('数量必须大于 0').max(9_999_999, '数量超出范围'),
});

export const returnCreateSchema = z.object({
  order_id: uuid,
  shipment_id: uuid.optional(),
  return_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 YYYY-MM-DD').optional(),
  reason: z.string().max(500, '退货原因不能超过 500 字').optional(),
  remark: z.string().max(500, '备注不能超过 500 字').optional(),
  /** 退回入库仓库（可空，空=默认仓 WH01） */
  warehouse_id: uuid.nullish(),
  items: z.array(itemSchema).min(1, '至少需要一行明细').max(200, '明细行过多'),
});
export type ReturnCreateInput = z.infer<typeof returnCreateSchema>;

const RETURN_STATUSES = ['draft', 'pending', 'approved', 'rejected', 'closed'] as const;

function toNumber(value: string | number | null): number {
  return value === null ? 0 : Number(value);
}

async function fetchNameMap(
  table: 'md_customers' | 'md_products' | 'sys_users',
  ids: string[],
  field = 'name',
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (ids.length === 0) return map;
  const supabase = getSupabaseClient();
  const { data } = await supabase.from(table).select(`id, ${field}`).in('id', [...new Set(ids)]);
  for (const row of (data ?? []) as unknown as Array<{ id: string; [k: string]: string }>) {
    map.set(row.id, row[field]);
  }
  return map;
}

function serialize(
  row: SoReturn,
  extra: {
    orderNo?: string | null;
    shipmentNo?: string | null;
    customerName?: string | null;
    creatorName?: string | null;
    items?: ReturnItemView[];
    steps?: ApprovalStepView[];
  } = {},
): ReturnView {
  return {
    id: row.id,
    return_no: row.return_no,
    order_id: row.order_id,
    order_no: extra.orderNo ?? null,
    shipment_id: row.shipment_id ?? null,
    shipment_no: extra.shipmentNo ?? null,
    customer_id: row.customer_id,
    customer_name: extra.customerName ?? null,
    status: row.status,
    return_date: row.return_date,
    reason: row.reason ?? null,
    total_amount: toNumber(row.total_amount),
    approval_level: row.approval_level ?? null,
    current_step: row.current_step ?? 0,
    submitted_at: row.submitted_at ? new Date(row.submitted_at).toISOString() : null,
    approved_at: row.approved_at ? new Date(row.approved_at).toISOString() : null,
    reject_reason: row.reject_reason ?? null,
    remark: row.remark,
    warehouse_id: row.warehouse_id ?? null,
    created_by_name: extra.creatorName ?? null,
    created_at: new Date(row.created_at).toISOString(),
    items: extra.items,
    steps: extra.steps,
  };
}

export async function listReturns(
  query: ListQuery & { status?: string },
): Promise<PagedResult<ReturnView>> {
  const supabase = getSupabaseClient();
  let builder = supabase
    .from('so_returns')
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
  if (error) throwDbError(error, '查询销售退货单');

  const rows = (data ?? []) as SoReturn[];
  const orderIds = rows.map((r) => r.order_id);
  const { data: orderRows } = orderIds.length
    ? await supabase.from('so_sales_orders').select('id, order_no').in('id', orderIds)
    : { data: [] };
  const orderNos = new Map((orderRows ?? []).map((o) => [o.id as string, o.order_no as string]));
  const shipmentIds = rows.map((r) => r.shipment_id).filter((v): v is string => !!v);
  const { data: shipmentRows } = shipmentIds.length
    ? await supabase.from('so_shipments').select('id, shipment_no').in('id', [...new Set(shipmentIds)])
    : { data: [] };
  const shipmentNos = new Map((shipmentRows ?? []).map((s) => [s.id as string, s.shipment_no as string]));
  const customerNames = await fetchNameMap('md_customers', rows.map((r) => r.customer_id));
  const creatorNames = await fetchNameMap(
    'sys_users',
    rows.map((r) => r.created_by).filter((v): v is string => !!v),
    'display_name',
  );

  return {
    items: rows.map((row) =>
      serialize(row, {
        orderNo: orderNos.get(row.order_id),
        shipmentNo: row.shipment_id ? shipmentNos.get(row.shipment_id) : null,
        customerName: customerNames.get(row.customer_id),
        creatorName: row.created_by ? creatorNames.get(row.created_by) : null,
      }),
    ),
    total: count ?? 0,
    page: query.page,
    page_size: query.pageSize,
  };
}

export async function getReturn(id: string): Promise<ReturnView> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('so_returns').select('*').eq('id', id).maybeSingle();
  if (error) throwDbError(error, '查询销售退货单');
  if (!data) throw new ApiError(404, 'SO.NOT_FOUND', '销售退货单不存在');
  const row = data as SoReturn;

  const { data: itemRows } = await supabase
    .from('so_return_items')
    .select('*')
    .eq('return_id', id)
    .order('created_at', { ascending: true });
  const items = (itemRows ?? []) as SoReturnItem[];

  const productNames = await fetchNameMap('md_products', items.map((i) => i.product_id));
  const productSkus = new Map<string, string>();
  if (items.length > 0) {
    const { data: products } = await supabase
      .from('md_products')
      .select('id, sku_code')
      .in('id', [...new Set(items.map((i) => i.product_id))]);
    for (const p of products ?? []) productSkus.set(p.id as string, p.sku_code as string);
  }
  const { data: orderRow } = await supabase
    .from('so_sales_orders')
    .select('order_no')
    .eq('id', row.order_id)
    .maybeSingle();
  const { data: shipmentRow } = row.shipment_id
    ? await supabase
        .from('so_shipments')
        .select('shipment_no')
        .eq('id', row.shipment_id)
        .maybeSingle()
    : { data: null };
  const customerNames = await fetchNameMap('md_customers', [row.customer_id]);
  const creatorNames = row.created_by
    ? await fetchNameMap('sys_users', [row.created_by], 'display_name')
    : new Map<string, string>();
  const steps = await listSteps('sales_return', id);

  const itemViews: ReturnItemView[] = items.map((item) => ({
    id: item.id,
    product_id: item.product_id,
    product_name: productNames.get(item.product_id) ?? null,
    product_sku: productSkus.get(item.product_id) ?? null,
    quantity: toNumber(item.quantity),
    unit_price: toNumber(item.unit_price),
    amount: toNumber(item.amount),
    unit_cost: item.unit_cost === null ? null : toNumber(item.unit_cost),
    unit: item.unit,
  }));

  return serialize(row, {
    orderNo: (orderRow?.order_no as string | null) ?? null,
    shipmentNo: (shipmentRow?.shipment_no as string | null) ?? null,
    customerName: customerNames.get(row.customer_id),
    creatorName: row.created_by ? creatorNames.get(row.created_by) : null,
    items: itemViews,
    steps,
  });
}

/** 单号：SRyyyymmdd-NNNN（unique 约束兜底） */
async function generateReturnNo(): Promise<string> {
  return nextDocNo('SR', 'so_returns', 'return_no');
}

/**
 * 新建销售退货单（草稿）。
 * 订单须已出库（shipped）；单价取订单锁定成交价；回补成本单价快照当前移动加权均价。
 */
export async function createReturn(input: ReturnCreateInput, user: SysUser): Promise<ReturnView> {
  const supabase = getSupabaseClient();
  const { data: order, error: oErr } = await supabase
    .from('so_sales_orders')
    .select('*')
    .eq('id', input.order_id)
    .maybeSingle();
  if (oErr) throwDbError(oErr, '查询销售订单');
  if (!order) throw new ApiError(404, 'SO.NOT_FOUND', '销售订单不存在');
  if (order.status !== 'shipped' && order.status !== 'approved') {
    throw new ApiError(400, 'SO.BAD_TRANSITION', '仅已审或已出库的订单可创建退货单');
  }

  const { data: orderItems } = await supabase
    .from('so_sales_order_items')
    .select('*')
    .eq('order_id', input.order_id);
  const orderItemMap = new Map(
    ((orderItems ?? []) as Array<Record<string, unknown>>).map((i) => [i.product_id as string, i]),
  );

  // 退回仓：入参 > 订单仓 > 默认仓 WH01
  let warehouseId = input.warehouse_id ?? (order.warehouse_id as string | null);
  if (!warehouseId) {
    const { data: wh } = await supabase
      .from('inv_warehouses')
      .select('id')
      .eq('code', 'WH01')
      .maybeSingle();
    warehouseId = (wh?.id as string | undefined) ?? null;
  }

  // 当前移动加权均价快照（红字冲销口径，按退回仓取）
  const productIds = [...new Set(input.items.map((i) => i.product_id))];
  let stockReq = supabase
    .from('inv_stock')
    .select('product_id, avg_cost')
    .in('product_id', productIds);
  if (warehouseId) stockReq = stockReq.eq('warehouse_id', warehouseId);
  const { data: stockRows } = await stockReq;
  const avgMap = new Map(
    ((stockRows ?? []) as Array<Record<string, unknown>>).map((s) => [
      s.product_id as string,
      toNumber(s.avg_cost as string),
    ]),
  );

  let total = 0;
  const items = input.items.map((item) => {
    const src = orderItemMap.get(item.product_id);
    if (!src) throw new ApiError(400, 'SO.ITEM_NOT_IN_ORDER', '退货明细含订单外商品');
    const unitPrice = toNumber(src.unit_price as string);
    const amount = Math.round(item.quantity * unitPrice * 100) / 100;
    total = Math.round((total + amount) * 100) / 100;
    return {
      product_id: item.product_id,
      quantity: item.quantity,
      unit_price: unitPrice,
      amount,
      unit_cost: avgMap.get(item.product_id) ?? 0,
      unit: (src.unit as string | null) ?? null,
    };
  });

  const returnNo = await generateReturnNo();
  const { data, error } = await supabase
    .from('so_returns')
    .insert({
      return_no: returnNo,
      order_id: input.order_id,
      shipment_id: input.shipment_id ?? null,
      customer_id: order.customer_id as string,
      return_date: input.return_date ?? new Date().toISOString().slice(0, 10),
      reason: emptyToNull(input.reason),
      remark: emptyToNull(input.remark),
      total_amount: total,
      warehouse_id: warehouseId,
      created_by: user.id,
      status: 'draft',
    })
    .select('*')
    .single();
  if (error) {
    if (error.code === '23505') throw new ApiError(409, 'SO.DUPLICATE_NO', '单号冲突，请重试');
    throwDbError(error, '创建销售退货单');
  }
  const { error: itemErr } = await supabase
    .from('so_return_items')
    .insert(items.map((item) => ({ ...item, return_id: data.id })));
  if (itemErr) {
    await supabase.from('so_returns').delete().eq('id', data.id);
    throwDbError(itemErr, '保存退货明细');
  }
  return getReturn(data.id as string);
}

export async function deleteReturn(id: string): Promise<void> {
  const supabase = getSupabaseClient();
  const existing = await getReturn(id);
  if (existing.status !== 'draft' && existing.status !== 'rejected') {
    throw new ApiError(400, 'SO.BAD_TRANSITION', '仅草稿或已驳回的退货单可删除');
  }
  const { error } = await supabase.from('so_returns').delete().eq('id', id);
  if (error) throwDbError(error, '删除销售退货单');
}

export async function submitReturn(id: string, user: SysUser): Promise<ReturnView> {
  const doc = await getReturn(id);
  await submitDocument('sales_return', id, doc.total_amount, user);
  return getReturn(id);
}

export async function approveReturn(id: string, user: SysUser, comment?: string): Promise<ReturnView> {
  await approveCurrentStep('sales_return', id, user, comment);
  return getReturn(id);
}

export async function rejectReturn(id: string, user: SysUser, reason: string): Promise<ReturnView> {
  await rejectCurrentStep('sales_return', id, user, reason);
  return getReturn(id);
}
