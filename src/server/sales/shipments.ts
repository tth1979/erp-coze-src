/**
 * 销售出库单服务端逻辑（so_shipments / so_shipment_items）
 *
 * 链路：销售订单 approved → 创建出库单(draft) → 提交(pending) → 审批引擎逐级审批
 *       → 终审通过由数据库函数 so_execute_shipment 单事务完成：
 *         数量强校验（不超订单剩余可出库量）+ 负库存拦截 + 按移动加权均价结转成本
 *         （写入明细 cost 与单头 total_cost）+ 库存流水；订单全部出库后置 shipped。
 *
 * 金额按订单锁定成交价计算；仅 draft/rejected 可删除。
 */
import { z } from 'zod';
import { approveCurrentStep, listSteps, rejectCurrentStep, submitDocument, type ApprovalStepView } from '@/server/approval/engine';
import { nextDocNo } from '@/server/doc-no';
import { ApiError } from '@/server/http';
import { emptyToNull, escapeOrKeyword, throwDbError, type ListQuery, type PagedResult } from '@/server/master-data/helpers';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { onSalesShipment, onSalesShipmentCost, fetchCustomerName } from '@/server/ledger/events';
import type { SoShipment, SoShipmentItem, SysUser } from '@/storage/database/shared/schema';

export interface ShipmentItemView {
  id: string;
  product_id: string;
  product_name: string | null;
  product_sku: string | null;
  quantity: number;
  unit_price: number;
  amount: number;
  cost: number | null;
  unit: string | null;
}

export interface ShipmentView {
  id: string;
  shipment_no: string;
  order_id: string;
  order_no: string | null;
  customer_id: string;
  customer_name: string | null;
  status: string;
  ship_date: string;
  total_amount: number;
  total_cost: number;
  approval_level: number | null;
  current_step: number;
  submitted_at: string | null;
  approved_at: string | null;
  reject_reason: string | null;
  remark: string | null;
  /** 发货仓库（可空，空=默认仓 WH01） */
  warehouse_id: string | null;
  created_by_name: string | null;
  created_at: string;
  items?: ShipmentItemView[];
  steps?: ApprovalStepView[];
}

const uuid = z.string().regex(/^[0-9a-fA-F-]{36}$/, 'ID 格式不正确');

const itemSchema = z.object({
  product_id: uuid,
  quantity: z.number().positive('数量必须大于 0').max(9_999_999, '数量超出范围'),
});

export const shipmentCreateSchema = z.object({
  order_id: uuid,
  ship_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 YYYY-MM-DD').optional(),
  /** 发货仓库（可空，默认取订单仓，再兜底默认仓 WH01） */
  warehouse_id: uuid.nullish(),
  remark: z.string().max(500, '备注不能超过 500 字').optional(),
  items: z.array(itemSchema).min(1, '至少需要一行明细').max(200, '明细行过多'),
});
export type ShipmentCreateInput = z.infer<typeof shipmentCreateSchema>;

const SHIPMENT_STATUSES = ['draft', 'pending', 'approved', 'rejected', 'closed'] as const;

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
  row: SoShipment,
  extra: {
    orderNo?: string | null;
    customerName?: string | null;
    creatorName?: string | null;
    items?: ShipmentItemView[];
    steps?: ApprovalStepView[];
  } = {},
): ShipmentView {
  return {
    id: row.id,
    shipment_no: row.shipment_no,
    order_id: row.order_id,
    order_no: extra.orderNo ?? null,
    customer_id: row.customer_id,
    customer_name: extra.customerName ?? null,
    status: row.status,
    ship_date: row.ship_date,
    total_amount: toNumber(row.total_amount),
    total_cost: toNumber(row.total_cost),
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

export async function listShipments(
  query: ListQuery & { status?: string },
): Promise<PagedResult<ShipmentView>> {
  const supabase = getSupabaseClient();
  let builder = supabase
    .from('so_shipments')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false });
  if (query.status && (SHIPMENT_STATUSES as readonly string[]).includes(query.status)) {
    builder = builder.eq('status', query.status);
  }
  if (query.keyword) {
    const kw = escapeOrKeyword(query.keyword);
    if (kw) builder = builder.or(`shipment_no.ilike.%${kw}%,remark.ilike.%${kw}%`);
  }
  const from = (query.page - 1) * query.pageSize;
  const { data, error, count } = await builder.range(from, from + query.pageSize - 1);
  if (error) throwDbError(error, '查询销售出库单');

  const rows = (data ?? []) as SoShipment[];
  const orderIds = rows.map((r) => r.order_id);
  const { data: orderRows } = orderIds.length
    ? await supabase.from('so_sales_orders').select('id, order_no').in('id', orderIds)
    : { data: [] };
  const orderNos = new Map((orderRows ?? []).map((o) => [o.id as string, o.order_no as string]));
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
        customerName: customerNames.get(row.customer_id),
        creatorName: row.created_by ? creatorNames.get(row.created_by) : null,
      }),
    ),
    total: count ?? 0,
    page: query.page,
    page_size: query.pageSize,
  };
}

export async function getShipment(id: string): Promise<ShipmentView> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('so_shipments').select('*').eq('id', id).maybeSingle();
  if (error) throwDbError(error, '查询销售出库单');
  if (!data) throw new ApiError(404, 'SO.NOT_FOUND', '销售出库单不存在');
  const row = data as SoShipment;

  const { data: itemRows } = await supabase
    .from('so_shipment_items')
    .select('*')
    .eq('shipment_id', id)
    .order('created_at', { ascending: true });
  const items = (itemRows ?? []) as SoShipmentItem[];

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
  const customerNames = await fetchNameMap('md_customers', [row.customer_id]);
  const creatorNames = row.created_by
    ? await fetchNameMap('sys_users', [row.created_by], 'display_name')
    : new Map<string, string>();
  const steps = await listSteps('shipment', id);

  const itemViews: ShipmentItemView[] = items.map((item) => ({
    id: item.id,
    product_id: item.product_id,
    product_name: productNames.get(item.product_id) ?? null,
    product_sku: productSkus.get(item.product_id) ?? null,
    quantity: toNumber(item.quantity),
    unit_price: toNumber(item.unit_price),
    amount: toNumber(item.amount),
    cost: item.cost === null ? null : toNumber(item.cost),
    unit: item.unit,
  }));

  return serialize(row, {
    orderNo: (orderRow?.order_no as string | null) ?? null,
    customerName: customerNames.get(row.customer_id),
    creatorName: row.created_by ? creatorNames.get(row.created_by) : null,
    items: itemViews,
    steps,
  });
}

/** 单号：SHyyyymmdd-NNNN（unique 约束兜底，冲突重试一次） */
async function generateShipmentNo(): Promise<string> {
  return nextDocNo('SH', 'so_shipments', 'shipment_no');
}

/**
 * 从已审销售订单创建出库单（草稿）。
 * 数量预填订单量，允许调减；单价/金额强制取订单锁定成交价（不信任客户端）。
 * 超剩余量在执行终审时由数据库函数强校验。
 */
export async function createShipment(input: ShipmentCreateInput, user: SysUser): Promise<ShipmentView> {
  const supabase = getSupabaseClient();
  const { data: order, error: oErr } = await supabase
    .from('so_sales_orders')
    .select('*')
    .eq('id', input.order_id)
    .maybeSingle();
  if (oErr) throwDbError(oErr, '查询销售订单');
  if (!order) throw new ApiError(404, 'SO.NOT_FOUND', '销售订单不存在');
  if (order.status !== 'approved') {
    throw new ApiError(400, 'SO.BAD_TRANSITION', '仅已审销售订单可创建出库单');
  }

  const { data: orderItems } = await supabase
    .from('so_sales_order_items')
    .select('*')
    .eq('order_id', input.order_id);
  const orderItemMap = new Map(
    ((orderItems ?? []) as Array<Record<string, unknown>>).map((i) => [i.product_id as string, i]),
  );

  let total = 0;
  const items = input.items.map((item) => {
    const src = orderItemMap.get(item.product_id);
    if (!src) throw new ApiError(400, 'SO.ITEM_NOT_IN_ORDER', '出库明细含订单外商品');
    const unitPrice = toNumber(src.unit_price as string);
    const amount = Math.round(item.quantity * unitPrice * 100) / 100;
    total = Math.round((total + amount) * 100) / 100;
    return {
      product_id: item.product_id,
      quantity: item.quantity,
      unit_price: unitPrice,
      amount,
      unit: (src.unit as string | null) ?? null,
    };
  });

  const shipmentNo = await generateShipmentNo();
  const { data, error } = await supabase
    .from('so_shipments')
    .insert({
      shipment_no: shipmentNo,
      order_id: input.order_id,
      customer_id: order.customer_id as string,
      ship_date: input.ship_date ?? new Date().toISOString().slice(0, 10),
      total_amount: total,
      remark: emptyToNull(input.remark),
      warehouse_id: input.warehouse_id ?? (order.warehouse_id as string | null) ?? null,
      created_by: user.id,
      status: 'draft',
    })
    .select('*')
    .single();
  if (error) {
    if (error.code === '23505') throw new ApiError(409, 'SO.DUPLICATE_NO', '单号冲突，请重试');
    throwDbError(error, '创建销售出库单');
  }
  const { error: itemErr } = await supabase
    .from('so_shipment_items')
    .insert(items.map((item) => ({ ...item, shipment_id: data.id })));
  if (itemErr) {
    await supabase.from('so_shipments').delete().eq('id', data.id);
    throwDbError(itemErr, '保存出库明细');
  }
  return getShipment(data.id as string);
}

export async function deleteShipment(id: string): Promise<void> {
  const supabase = getSupabaseClient();
  const existing = await getShipment(id);
  if (existing.status !== 'draft' && existing.status !== 'rejected') {
    throw new ApiError(400, 'SO.BAD_TRANSITION', '仅草稿或已驳回的出库单可删除');
  }
  const { error } = await supabase.from('so_shipments').delete().eq('id', id);
  if (error) throwDbError(error, '删除销售出库单');
}

export async function submitShipment(id: string, user: SysUser): Promise<ShipmentView> {
  const doc = await getShipment(id);
  await submitDocument('shipment', id, doc.total_amount, user);
  return getShipment(id);
}

export async function approveShipment(id: string, user: SysUser, comment?: string): Promise<ShipmentView> {
  await approveCurrentStep('shipment', id, user, comment);
  const view = await getShipment(id);
  // 终审出库后自动生成确认收入凭证 + 销项税登记（幂等）
  if (view.status === 'approved') {
    const customerName = await fetchCustomerName(view.customer_id);
    await onSalesShipment({
      shipment_id: id,
      shipment_no: view.shipment_no,
      customer_name: customerName,
      items: (view.items ?? []).map((i) => ({ product_id: i.product_id, quantity: Number(i.quantity), unit_price: Number(i.unit_price) })),
      operatorId: user.id,
    });
    // 销售成本结转凭证（与收入凭证区分模板，幂等）
    await onSalesShipmentCost({
      shipment_id: id,
      shipment_no: view.shipment_no,
      cost: Number(view.total_cost ?? 0),
      operatorId: user.id,
    });
  }
  return view;
}

export async function rejectShipment(id: string, user: SysUser, reason: string): Promise<ShipmentView> {
  await rejectCurrentStep('shipment', id, user, reason);
  return getShipment(id);
}
