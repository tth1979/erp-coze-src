/**
 * 销售订单服务端逻辑（so_*，V2 审批版）
 *
 * 状态机：draft(草稿) → pending(待审) → approved(已审) → shipped(已出库)
 *                ↘ rejected(驳回，可编辑重提)   draft/pending/rejected → closed(关闭)
 * 仅 draft/rejected 可编辑，仅 draft 可删除；金额一律由服务端按明细行计算，
 * 审批通过即锁定成交价（后续出库/退货均按订单价）。
 *
 * 价格策略雏形：客户等级折扣（normal 100% / vip 98% / strategic 95%）× 商品参考售价，
 * 由 quote 接口给出建议价；成交价以后端落库为准，不做强制下限（后置里程碑接价格审批）。
 */
import { z } from 'zod';
import { approveCurrentStep, listSteps, rejectCurrentStep, submitDocument, type ApprovalStepView } from '@/server/approval/engine';
import { nextDocNo } from '@/server/doc-no';
import { ApiError } from '@/server/http';
import { throwInventoryRpcError } from '@/server/inventory/shared';
import { emptyToNull, escapeOrKeyword, throwDbError, type ListQuery, type PagedResult } from '@/server/master-data/helpers';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { onSalesShipment, fetchCustomerName } from '@/server/ledger/events';
import type { SoSalesOrder, SoSalesOrderItem, SysUser } from '@/storage/database/shared/schema';

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export interface SalesOrderItemView {
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

export interface SalesOrderView {
  id: string;
  order_no: string;
  customer_id: string;
  customer_name: string | null;
  customer_level: string | null;
  status: string;
  order_date: string;
  total_amount: number;
  item_count: number;
  remark: string | null;
  created_by_name: string | null;
  approval_level: number | null;
  current_step: number;
  submitted_at: string | null;
  approved_by_name: string | null;
  approved_at: string | null;
  reject_reason: string | null;
  confirmed_at: string | null;
  cancelled_at: string | null;
  /** 发货仓库（可空，空=默认仓 WH01） */
  warehouse_id: string | null;
  created_at: string;
  updated_at: string;
  items?: SalesOrderItemView[];
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

export const orderUpsertSchema = z.object({
  customer_id: uuid,
  order_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 YYYY-MM-DD')
    .optional(),
  remark: z.string().max(500, '备注不能超过 500 字').optional(),
  /** 发货仓库（可空，空=默认仓 WH01） */
  warehouse_id: uuid.nullish(),
  items: z.array(itemSchema).min(1, '至少需要一行明细').max(200, '明细行过多'),
});
export type OrderUpsertInput = z.infer<typeof orderUpsertSchema>;

const ORDER_STATUSES = ['draft', 'pending', 'approved', 'rejected', 'shipped', 'closed'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

// ---------------------------------------------------------------------------
// 序列化
// ---------------------------------------------------------------------------

function toNumber(value: string | number | null): number {
  return value === null ? 0 : Number(value);
}

function serialize(
  row: SoSalesOrder,
  extra: {
    customerName?: string | null;
    customerLevel?: string | null;
    creatorName?: string | null;
    approverName?: string | null;
    itemCount?: number;
    items?: SalesOrderItemView[];
    steps?: ApprovalStepView[];
  } = {},
): SalesOrderView {
  return {
    id: row.id,
    order_no: row.order_no,
    customer_id: row.customer_id,
    customer_name: extra.customerName ?? null,
    customer_level: extra.customerLevel ?? null,
    status: row.status,
    order_date: row.order_date,
    total_amount: toNumber(row.total_amount),
    item_count: extra.itemCount ?? 0,
    remark: row.remark,
    created_by_name: extra.creatorName ?? null,
    approval_level: row.approval_level ?? null,
    current_step: row.current_step ?? 0,
    submitted_at: row.submitted_at ? new Date(row.submitted_at).toISOString() : null,
    approved_by_name: extra.approverName ?? null,
    approved_at: row.approved_at ? new Date(row.approved_at).toISOString() : null,
    reject_reason: row.reject_reason ?? null,
    confirmed_at: row.confirmed_at ? new Date(row.confirmed_at).toISOString() : null,
    cancelled_at: row.cancelled_at ? new Date(row.cancelled_at).toISOString() : null,
    warehouse_id: row.warehouse_id ?? null,
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString(),
    items: extra.items,
    steps: extra.steps,
  };
}

// ---------------------------------------------------------------------------
// 辅助：批量补全关联名称（避免 N+1）
// ---------------------------------------------------------------------------

async function fetchNameMap(table: 'md_customers' | 'md_products' | 'sys_users', ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (ids.length === 0) return map;
  const supabase = getSupabaseClient();
  const field = table === 'sys_users' ? 'display_name' : 'name';
  const { data, error } = await supabase.from(table).select(`id, ${field}`).in('id', [...new Set(ids)]);
  if (error || !data) return map;
  for (const row of data as unknown as Array<{ id: string; [k: string]: string }>) {
    map.set(row.id, row[field]);
  }
  return map;
}

/** 生成销售单号 SOyyyymmdd-NNNN（唯一约束冲突时由调用方重试） */
async function generateOrderNo(): Promise<string> {
  return nextDocNo('SO', 'so_sales_orders', 'order_no');
}

interface PreparedItem {
  product_id: string;
  quantity: number;
  unit_price: number;
  amount: number;
  unit: string | null;
}

/** 校验客户与商品存在性，计算行金额与总额 */
async function prepareItems(input: OrderUpsertInput): Promise<{ items: PreparedItem[]; total: number }> {
  const supabase = getSupabaseClient();

  const { data: customer, error: customerErr } = await supabase
    .from('md_customers')
    .select('id, status')
    .eq('id', input.customer_id)
    .maybeSingle();
  if (customerErr) throwDbError(customerErr, '校验客户');
  if (!customer) throw new ApiError(400, 'SO.CUSTOMER_NOT_FOUND', '客户不存在');
  if (customer.status !== 'active') throw new ApiError(400, 'SO.CUSTOMER_DISABLED', '该客户已停用，不能开单');

  const productIds = [...new Set(input.items.map((item) => item.product_id))];
  const { data: products, error: productErr } = await supabase
    .from('md_products')
    .select('id, unit, status')
    .in('id', productIds);
  if (productErr) throwDbError(productErr, '校验商品');
  const productMap = new Map((products ?? []).map((p) => [p.id as string, p]));
  for (const pid of productIds) {
    if (!productMap.has(pid)) throw new ApiError(400, 'SO.PRODUCT_NOT_FOUND', '存在无效商品，请刷新后重试');
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

export async function listOrders(query: ListQuery & { status?: string }): Promise<PagedResult<SalesOrderView>> {
  const supabase = getSupabaseClient();
  let builder = supabase
    .from('so_sales_orders')
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
  if (error) throwDbError(error, '查询销售订单');

  const rows = (data ?? []) as SoSalesOrder[];
  const customerNames = await fetchNameMap('md_customers', rows.map((r) => r.customer_id));
  const creatorNames = await fetchNameMap('sys_users', rows.map((r) => r.created_by).filter((v): v is string => !!v));

  // 客户等级快照（列表展示 VIP/战略 标记）
  const customerLevels = new Map<string, string>();
  const customerIds = [...new Set(rows.map((r) => r.customer_id))];
  if (customerIds.length > 0) {
    const { data: customerRows } = await supabase
      .from('md_customers')
      .select('id, level')
      .in('id', customerIds);
    for (const c of customerRows ?? []) {
      customerLevels.set(c.id as string, (c.level as string | null) ?? 'normal');
    }
  }

  // 明细行数（本页订单）
  const orderIds = rows.map((r) => r.id);
  const itemCounts = new Map<string, number>();
  if (orderIds.length > 0) {
    const { data: itemRows } = await supabase
      .from('so_sales_order_items')
      .select('order_id')
      .in('order_id', orderIds);
    for (const item of (itemRows ?? []) as Array<{ order_id: string }>) {
      itemCounts.set(item.order_id, (itemCounts.get(item.order_id) ?? 0) + 1);
    }
  }

  return {
    items: rows.map((row) =>
      serialize(row, {
        customerName: customerNames.get(row.customer_id),
        customerLevel: customerLevels.get(row.customer_id) ?? null,
        creatorName: row.created_by ? creatorNames.get(row.created_by) : null,
        itemCount: itemCounts.get(row.id) ?? 0,
      }),
    ),
    total: count ?? 0,
    page: query.page,
    page_size: query.pageSize,
  };
}

export async function getOrder(id: string): Promise<SalesOrderView> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('so_sales_orders').select('*').eq('id', id).maybeSingle();
  if (error) throwDbError(error, '查询销售订单');
  if (!data) throw new ApiError(404, 'SO.NOT_FOUND', '销售订单不存在');
  const row = data as SoSalesOrder;

  const { data: itemRows, error: itemErr } = await supabase
    .from('so_sales_order_items')
    .select('*')
    .eq('order_id', id)
    .order('created_at', { ascending: true });
  if (itemErr) throwDbError(itemErr, '查询订单明细');
  const items = (itemRows ?? []) as SoSalesOrderItem[];

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

  const customerNames = await fetchNameMap('md_customers', [row.customer_id]);
  const { data: customerRow } = await supabase
    .from('md_customers')
    .select('level')
    .eq('id', row.customer_id)
    .maybeSingle();
  const creatorNames = row.created_by ? await fetchNameMap('sys_users', [row.created_by]) : new Map<string, string>();
  const approverNames = row.approved_by ? await fetchNameMap('sys_users', [row.approved_by]) : new Map<string, string>();
  const steps = await listSteps('sales_order', id);

  const itemViews: SalesOrderItemView[] = items.map((item) => ({
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
    customerName: customerNames.get(row.customer_id),
    customerLevel: (customerRow?.level as string | null) ?? null,
    creatorName: row.created_by ? creatorNames.get(row.created_by) : null,
    approverName: row.approved_by ? approverNames.get(row.approved_by) : null,
    itemCount: itemViews.length,
    items: itemViews,
    steps,
  });
}

// ---------------------------------------------------------------------------
// 写入
// ---------------------------------------------------------------------------

export async function createOrder(input: OrderUpsertInput, operatorId: string): Promise<SalesOrderView> {
  const supabase = getSupabaseClient();
  const { items, total } = await prepareItems(input);
  const orderDate = input.order_date ?? new Date().toISOString().slice(0, 10);
  const remark = emptyToNull(input.remark);

  // 单号唯一冲突时重试一次（并发兜底）
  let order: SoSalesOrder | null = null;
  for (let attempt = 0; attempt < 2 && !order; attempt += 1) {
    const orderNo = await generateOrderNo();
    const { data, error } = await supabase
      .from('so_sales_orders')
      .insert({
        order_no: orderNo,
        customer_id: input.customer_id,
        order_date: orderDate,
        total_amount: total,
        remark,
        warehouse_id: input.warehouse_id ?? null,
        created_by: operatorId,
        status: 'draft',
      })
      .select('*')
      .single();
    if (error) {
      if (error.code === '23505' && attempt === 0) continue;
      throwDbError(error, '创建销售订单');
    }
    order = data as SoSalesOrder;
  }
  if (!order) throw new ApiError(500, 'SO.DB_ERROR', '创建销售订单失败');

  const { error: itemErr } = await supabase
    .from('so_sales_order_items')
    .insert(items.map((item) => ({ ...item, order_id: order.id })));
  if (itemErr) {
    // 补偿：删除订单头（明细随级联为空）
    await supabase.from('so_sales_orders').delete().eq('id', order.id);
    throwDbError(itemErr, '保存订单明细');
  }
  return getOrder(order.id);
}

export async function updateOrder(id: string, input: OrderUpsertInput): Promise<SalesOrderView> {
  const supabase = getSupabaseClient();
  const existing = await getOrder(id);
  if (existing.status !== 'draft' && existing.status !== 'rejected') {
    throw new ApiError(400, 'SO.NOT_DRAFT', '只有草稿或已驳回状态的订单可以编辑');
  }
  const { items, total } = await prepareItems(input);

  const { error } = await supabase
    .from('so_sales_orders')
    .update({
      customer_id: input.customer_id,
      order_date: input.order_date ?? existing.order_date,
      remark: emptyToNull(input.remark),
      warehouse_id: input.warehouse_id ?? existing.warehouse_id,
      total_amount: total,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) throwDbError(error, '更新销售订单');

  // 明细整组替换
  const { error: delErr } = await supabase.from('so_sales_order_items').delete().eq('order_id', id);
  if (delErr) throwDbError(delErr, '更新订单明细');
  const { error: insErr } = await supabase
    .from('so_sales_order_items')
    .insert(items.map((item) => ({ ...item, order_id: id })));
  if (insErr) throwDbError(insErr, '更新订单明细');

  return getOrder(id);
}

export async function deleteOrder(id: string): Promise<void> {
  const supabase = getSupabaseClient();
  const existing = await getOrder(id);
  if (existing.status !== 'draft') {
    throw new ApiError(400, 'SO.NOT_DRAFT', '只有草稿状态的订单可以删除');
  }
  const { error } = await supabase.from('so_sales_orders').delete().eq('id', id);
  if (error) throwDbError(error, '删除销售订单');
}

// ---------------------------------------------------------------------------
// 状态流转（审批引擎驱动）
// ---------------------------------------------------------------------------

/** 提交审批：draft/rejected → pending（按金额命中审批级别） */
export async function submitOrder(id: string, user: SysUser): Promise<SalesOrderView> {
  const order = await getOrder(id);
  await submitDocument('sales_order', id, order.total_amount, user);
  return getOrder(id);
}

/** 审批通过当前步（终审通过 → approved，成交价锁定） */
export async function approveOrder(id: string, user: SysUser, comment?: string): Promise<SalesOrderView> {
  await approveCurrentStep('sales_order', id, user, comment);
  return getOrder(id);
}

/** 驳回当前步（→ rejected，可编辑重提） */
export async function rejectOrder(id: string, user: SysUser, reason: string): Promise<SalesOrderView> {
  await rejectCurrentStep('sales_order', id, user, reason);
  return getOrder(id);
}

export async function cancelOrder(id: string): Promise<SalesOrderView> {
  const supabase = getSupabaseClient();
  const existing = await getOrder(id);
  if (!['draft', 'pending', 'rejected'].includes(existing.status)) {
    throw new ApiError(400, 'SO.BAD_TRANSITION', '当前状态不允许关闭');
  }
  const { error } = await supabase
    .from('so_sales_orders')
    .update({ status: 'closed', cancelled_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throwDbError(error, '关闭销售订单');
  return getOrder(id);
}

/**
 * 一键发货出库：approved → shipped。
 * 数据库函数 so_fulfill_order 单事务完成：自动生成已审出库单 + 扣库存 +
 * 结转成本 + 订单置 shipped；库存不足或重复出库整单回滚。
 */
export async function completeOrder(id: string, operatorId: string): Promise<{ shipment_no: string }> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc('so_fulfill_order', {
    p_order_id: id,
    p_user_id: operatorId,
  });
  if (error) throwInventoryRpcError(error, '销售发货');
  const shipmentNo = data as string;
  // 一键发货也走终审出库，给该出库单生成确认收入凭证 + 销项税登记（幂等）
  const sh = await getSupabaseClient().from('so_shipments').select('id, customer_id, shipment_no').eq('shipment_no', shipmentNo).maybeSingle();
  if (sh.data) {
    const items = await getSupabaseClient().from('so_shipment_items').select('product_id, quantity, unit_price').eq('shipment_id', sh.data.id);
    const customerName = await fetchCustomerName(sh.data.customer_id as string);
    await onSalesShipment({
      shipment_id: sh.data.id as string,
      shipment_no: shipmentNo,
      customer_name: customerName,
      items: (items.data ?? []).map((i) => ({ product_id: i.product_id, quantity: Number(i.quantity), unit_price: Number(i.unit_price) })),
      operatorId,
    });
  }
  return { shipment_no: shipmentNo };
}

// ---------------------------------------------------------------------------
// 价格策略雏形：客户等级折扣 × 商品参考售价 → 建议成交价
// ---------------------------------------------------------------------------

/** 客户等级折扣表（后置可迁移到配置表） */
export const LEVEL_DISCOUNT: Record<string, number> = {
  normal: 1,
  vip: 0.98,
  strategic: 0.95,
};

export interface QuoteResult {
  customer_id: string;
  product_id: string;
  customer_level: string;
  base_price: number;
  discount: number;
  /** 建议成交价（前端预填，可由业务员调整；订单落库即锁定） */
  price: number;
}

/** 销售建议价：商品参考售价 × 客户等级折扣（保留两位小数） */
export async function quotePrice(customerId: string, productId: string): Promise<QuoteResult> {
  const supabase = getSupabaseClient();
  const { data: customer, error: cErr } = await supabase
    .from('md_customers')
    .select('id, level, status')
    .eq('id', customerId)
    .maybeSingle();
  if (cErr) throwDbError(cErr, '查询客户');
  if (!customer) throw new ApiError(404, 'SO.CUSTOMER_NOT_FOUND', '客户不存在');

  const { data: product, error: pErr } = await supabase
    .from('md_products')
    .select('id, reference_sale_price, status')
    .eq('id', productId)
    .maybeSingle();
  if (pErr) throwDbError(pErr, '查询商品');
  if (!product) throw new ApiError(404, 'SO.PRODUCT_NOT_FOUND', '商品不存在');

  const level = (customer.level as string | null) ?? 'normal';
  const discount = LEVEL_DISCOUNT[level] ?? 1;
  const base = toNumber(product.reference_sale_price as string | number | null);
  return {
    customer_id: customerId,
    product_id: productId,
    customer_level: level,
    base_price: base,
    discount,
    price: Math.round(base * discount * 100) / 100,
  };
}
