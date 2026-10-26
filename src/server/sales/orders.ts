/**
 * 销售订单服务端逻辑（so_*）
 *
 * 状态机：draft → confirmed → completed（库存里程碑接入销售出库后流转）
 *                ↘ cancelled（draft/confirmed 可取消）
 * 仅 draft 可编辑/删除；金额一律由服务端按明细行计算，不信任客户端。
 *
 * 注意：Supabase SDK 无多语句事务，"订单头+明细"写入采用补偿模式
 * （明细失败则删除订单头），MVP 规模可接受；后续迁移存储过程或 Edge Function。
 */
import { z } from 'zod';
import { ApiError } from '@/server/http';
import { emptyToNull, escapeOrKeyword, throwDbError, type ListQuery, type PagedResult } from '@/server/master-data/helpers';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import type { SoSalesOrder, SoSalesOrderItem } from '@/storage/database/shared/schema';

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
  items?: SalesOrderItemView[];
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
  items: z.array(itemSchema).min(1, '至少需要一行明细').max(200, '明细行过多'),
});
export type OrderUpsertInput = z.infer<typeof orderUpsertSchema>;

const ORDER_STATUSES = ['draft', 'confirmed', 'completed', 'cancelled'] as const;
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
    creatorName?: string | null;
    itemCount?: number;
    items?: SalesOrderItemView[];
  } = {},
): SalesOrderView {
  return {
    id: row.id,
    order_no: row.order_no,
    customer_id: row.customer_id,
    customer_name: extra.customerName ?? null,
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
    items: extra.items,
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
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const prefix = `SO${y}${m}${d}`;
  const supabase = getSupabaseClient();
  const { count, error } = await supabase
    .from('so_sales_orders')
    .select('id', { count: 'exact', head: true })
    .like('order_no', `${prefix}%`);
  if (error) throwDbError(error, '生成销售单号');
  return `${prefix}-${String((count ?? 0) + 1).padStart(4, '0')}`;
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
  const creatorNames = row.created_by ? await fetchNameMap('sys_users', [row.created_by]) : new Map<string, string>();

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
    creatorName: row.created_by ? creatorNames.get(row.created_by) : null,
    itemCount: itemViews.length,
    items: itemViews,
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
  if (existing.status !== 'draft') {
    throw new ApiError(400, 'SO.NOT_DRAFT', '只有草稿状态的订单可以编辑');
  }
  const { items, total } = await prepareItems(input);

  const { error } = await supabase
    .from('so_sales_orders')
    .update({
      customer_id: input.customer_id,
      order_date: input.order_date ?? existing.order_date,
      remark: emptyToNull(input.remark),
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

export async function confirmOrder(id: string): Promise<SalesOrderView> {
  const supabase = getSupabaseClient();
  const existing = await getOrder(id);
  if (existing.status !== 'draft') {
    throw new ApiError(400, 'SO.BAD_TRANSITION', '只有草稿状态的订单可以确认');
  }
  const { error } = await supabase
    .from('so_sales_orders')
    .update({ status: 'confirmed', confirmed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throwDbError(error, '确认销售订单');
  return getOrder(id);
}

export async function cancelOrder(id: string): Promise<SalesOrderView> {
  const supabase = getSupabaseClient();
  const existing = await getOrder(id);
  if (existing.status !== 'draft' && existing.status !== 'confirmed') {
    throw new ApiError(400, 'SO.BAD_TRANSITION', '当前状态不允许取消');
  }
  const { error } = await supabase
    .from('so_sales_orders')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throwDbError(error, '取消销售订单');
  return getOrder(id);
}
