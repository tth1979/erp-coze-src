/**
 * 采购申请单服务端逻辑（po_requisitions / po_requisition_items）
 *
 * 状态机：draft → pending → approved → closed（转入采购订单后关闭）
 *                ↘ rejected（可编辑后重新提交）
 * 审批走通用引擎（approval.ts，按估算总额分级）；approved 后 convert 生成 draft 采购订单。
 * 金额一律服务端按明细计算（quantity × suggest_price）。
 */
import { z } from 'zod';
import { nextDocNo } from '@/server/doc-no';
import { ApiError } from '@/server/http';
import { emptyToNull, escapeOrKeyword, throwDbError, type ListQuery, type PagedResult } from '@/server/master-data/helpers';
import { approveCurrentStep, listSteps, rejectCurrentStep, submitDocument, type ApprovalStepView } from '@/server/approval/engine';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import type { PoRequisition, PoRequisitionItem, SysUser } from '@/storage/database/shared/schema';
import { createOrder } from '@/server/purchase/orders';
import type { PurchaseOrderView } from '@/server/purchase/orders';

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export interface RequisitionItemView {
  id: string;
  product_id: string;
  product_name: string | null;
  product_sku: string | null;
  quantity: number;
  suggest_price: number;
  amount: number;
  unit: string | null;
  remark: string | null;
}

export interface RequisitionView {
  id: string;
  req_no: string;
  status: string;
  reason: string | null;
  total_estimate: number;
  item_count: number;
  approval_level: number | null;
  current_step: number;
  submitted_at: string | null;
  approved_by_name: string | null;
  approved_at: string | null;
  reject_reason: string | null;
  converted_order_id: string | null;
  converted_order_no: string | null;
  remark: string | null;
  created_by_name: string | null;
  created_at: string;
  items?: RequisitionItemView[];
  steps?: ApprovalStepView[];
}

// ---------------------------------------------------------------------------
// 校验
// ---------------------------------------------------------------------------

const uuid = z.string().regex(/^[0-9a-fA-F-]{36}$/, 'ID 格式不正确');

const itemSchema = z.object({
  product_id: uuid,
  quantity: z.number().positive('数量必须大于 0').max(9_999_999, '数量超出范围'),
  suggest_price: z.number().min(0, '建议价不能为负').max(99_999_999, '建议价超出范围').default(0),
  remark: z.string().max(200, '行备注过长').optional(),
});

export const requisitionUpsertSchema = z.object({
  reason: z.string().max(500, '申请事由不能超过 500 字').optional(),
  remark: z.string().max(500, '备注不能超过 500 字').optional(),
  items: z.array(itemSchema).min(1, '至少需要一行明细').max(200, '明细行过多'),
});
export type RequisitionUpsertInput = z.infer<typeof requisitionUpsertSchema>;

export const REQUISITION_STATUSES = ['draft', 'pending', 'approved', 'rejected', 'closed'] as const;

/** 转采购订单入参：供应商必选，可覆盖明细单价/数量（缺省沿用申请明细） */
export const convertSchema = z.object({
  supplier_id: uuid,
  items: z
    .array(
      z.object({
        product_id: uuid,
        quantity: z.number().positive('数量必须大于 0').max(9_999_999, '数量超出范围'),
        unit_price: z.number().min(0, '单价不能为负').max(99_999_999, '单价超出范围'),
      }),
    )
    .min(1)
    .max(200)
    .optional(),
});
export type ConvertInput = z.infer<typeof convertSchema>;

// ---------------------------------------------------------------------------
// 序列化与辅助
// ---------------------------------------------------------------------------

function toNumber(value: string | number | null): number {
  return value === null ? 0 : Number(value);
}

async function fetchNameMap(table: 'md_products' | 'sys_users', ids: (string | null)[]): Promise<Map<string, string>> {
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

function serialize(row: PoRequisition, extra: Partial<RequisitionView> = {}): RequisitionView {
  return {
    id: row.id,
    req_no: row.req_no,
    status: row.status,
    reason: row.reason,
    total_estimate: toNumber(row.total_estimate),
    item_count: extra.item_count ?? 0,
    approval_level: row.approval_level,
    current_step: row.current_step,
    submitted_at: row.submitted_at ? new Date(row.submitted_at).toISOString() : null,
    approved_by_name: extra.approved_by_name ?? null,
    approved_at: row.approved_at ? new Date(row.approved_at).toISOString() : null,
    reject_reason: row.reject_reason,
    converted_order_id: row.converted_order_id,
    converted_order_no: extra.converted_order_no ?? null,
    remark: row.remark,
    created_by_name: extra.created_by_name ?? null,
    created_at: new Date(row.created_at).toISOString(),
    items: extra.items,
    steps: extra.steps,
  };
}

/** 申请单号 PRyyyymmdd-NNNN（唯一冲突由调用方重试） */
async function generateReqNo(): Promise<string> {
  return nextDocNo('PR', 'po_requisitions', 'req_no');
}

interface PreparedItem {
  product_id: string;
  quantity: number;
  suggest_price: number;
  amount: number;
  unit: string | null;
  remark: string | null;
}

/** 校验商品存在性，服务端计算行金额与估算总额 */
async function prepareItems(input: RequisitionUpsertInput): Promise<{ items: PreparedItem[]; total: number }> {
  const supabase = getSupabaseClient();
  const productIds = [...new Set(input.items.map((i) => i.product_id))];
  const { data: products, error } = await supabase.from('md_products').select('id, unit').in('id', productIds);
  if (error) throwDbError(error, '校验商品');
  const productMap = new Map((products ?? []).map((p) => [p.id as string, p]));
  for (const pid of productIds) {
    if (!productMap.has(pid)) throw new ApiError(400, 'PO.PRODUCT_NOT_FOUND', '存在无效商品，请刷新后重试');
  }
  let total = 0;
  const items: PreparedItem[] = input.items.map((item) => {
    const amount = Math.round(item.quantity * item.suggest_price * 100) / 100;
    total = Math.round((total + amount) * 100) / 100;
    return {
      product_id: item.product_id,
      quantity: item.quantity,
      suggest_price: item.suggest_price,
      amount,
      unit: (productMap.get(item.product_id)?.unit as string | null) ?? null,
      remark: emptyToNull(item.remark),
    };
  });
  return { items, total };
}

// ---------------------------------------------------------------------------
// 查询
// ---------------------------------------------------------------------------

export async function listRequisitions(query: ListQuery & { status?: string }): Promise<PagedResult<RequisitionView>> {
  const supabase = getSupabaseClient();
  let builder = supabase
    .from('po_requisitions')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false });

  if (query.status && (REQUISITION_STATUSES as readonly string[]).includes(query.status)) {
    builder = builder.eq('status', query.status);
  }
  if (query.keyword) {
    const kw = escapeOrKeyword(query.keyword);
    if (kw) builder = builder.or(`req_no.ilike.%${kw}%,reason.ilike.%${kw}%`);
  }

  const from = (query.page - 1) * query.pageSize;
  const { data, error, count } = await builder.range(from, from + query.pageSize - 1);
  if (error) throwDbError(error, '查询采购申请单');

  const rows = (data ?? []) as PoRequisition[];
  const creatorNames = await fetchNameMap('sys_users', rows.map((r) => r.created_by));

  const ids = rows.map((r) => r.id);
  const itemCounts = new Map<string, number>();
  if (ids.length > 0) {
    const { data: itemRows } = await supabase.from('po_requisition_items').select('requisition_id').in('requisition_id', ids);
    for (const item of (itemRows ?? []) as Array<{ requisition_id: string }>) {
      itemCounts.set(item.requisition_id, (itemCounts.get(item.requisition_id) ?? 0) + 1);
    }
  }

  return {
    items: rows.map((row) =>
      serialize(row, {
        item_count: itemCounts.get(row.id) ?? 0,
        created_by_name: row.created_by ? creatorNames.get(row.created_by) : null,
      }),
    ),
    total: count ?? 0,
    page: query.page,
    page_size: query.pageSize,
  };
}

export async function getRequisition(id: string): Promise<RequisitionView> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('po_requisitions').select('*').eq('id', id).maybeSingle();
  if (error) throwDbError(error, '查询采购申请单');
  if (!data) throw new ApiError(404, 'PO.NOT_FOUND', '采购申请单不存在');
  const row = data as PoRequisition;

  const { data: itemRows, error: itemErr } = await supabase
    .from('po_requisition_items')
    .select('*')
    .eq('requisition_id', id)
    .order('created_at', { ascending: true });
  if (itemErr) throwDbError(itemErr, '查询申请明细');
  const items = (itemRows ?? []) as PoRequisitionItem[];

  const productNames = await fetchNameMap('md_products', items.map((i) => i.product_id));
  const skuMap = new Map<string, string>();
  if (items.length > 0) {
    const { data: products } = await supabase
      .from('md_products')
      .select('id, sku_code')
      .in('id', [...new Set(items.map((i) => i.product_id))]);
    for (const p of products ?? []) skuMap.set(p.id as string, p.sku_code as string);
  }
  const creatorNames = await fetchNameMap('sys_users', [row.created_by, row.approved_by]);

  let convertedOrderNo: string | null = null;
  if (row.converted_order_id) {
    const { data: order } = await supabase
      .from('po_purchase_orders')
      .select('order_no')
      .eq('id', row.converted_order_id)
      .maybeSingle();
    convertedOrderNo = (order?.order_no as string | undefined) ?? null;
  }

  const steps = await listSteps('requisition', id);

  const itemViews: RequisitionItemView[] = items.map((item) => ({
    id: item.id,
    product_id: item.product_id,
    product_name: productNames.get(item.product_id) ?? null,
    product_sku: skuMap.get(item.product_id) ?? null,
    quantity: toNumber(item.quantity),
    suggest_price: toNumber(item.suggest_price),
    amount: toNumber(item.amount),
    unit: item.unit,
    remark: item.remark,
  }));

  return serialize(row, {
    item_count: itemViews.length,
    created_by_name: row.created_by ? creatorNames.get(row.created_by) : null,
    approved_by_name: row.approved_by ? creatorNames.get(row.approved_by) : null,
    converted_order_no: convertedOrderNo,
    items: itemViews,
    steps,
  });
}

// ---------------------------------------------------------------------------
// 写入
// ---------------------------------------------------------------------------

export async function createRequisition(input: RequisitionUpsertInput, operatorId: string): Promise<RequisitionView> {
  const supabase = getSupabaseClient();
  const { items, total } = await prepareItems(input);

  let row: PoRequisition | null = null;
  for (let attempt = 0; attempt < 2 && !row; attempt += 1) {
    const reqNo = await generateReqNo();
    const { data, error } = await supabase
      .from('po_requisitions')
      .insert({
        req_no: reqNo,
        status: 'draft',
        reason: emptyToNull(input.reason),
        total_estimate: total,
        remark: emptyToNull(input.remark),
        created_by: operatorId,
      })
      .select('*')
      .single();
    if (error) {
      if (error.code === '23505' && attempt === 0) continue;
      throwDbError(error, '创建采购申请单');
    }
    row = data as PoRequisition;
  }
  if (!row) throw new ApiError(500, 'PO.DB_ERROR', '创建采购申请单失败');

  const { error: itemErr } = await supabase
    .from('po_requisition_items')
    .insert(items.map((item) => ({ ...item, requisition_id: row.id })));
  if (itemErr) {
    await supabase.from('po_requisitions').delete().eq('id', row.id);
    throwDbError(itemErr, '保存申请明细');
  }
  return getRequisition(row.id);
}

export async function updateRequisition(id: string, input: RequisitionUpsertInput): Promise<RequisitionView> {
  const supabase = getSupabaseClient();
  const existing = await getRequisition(id);
  if (existing.status !== 'draft' && existing.status !== 'rejected') {
    throw new ApiError(400, 'PO.NOT_DRAFT', '只有草稿或已驳回状态的申请单可以编辑');
  }
  const { items, total } = await prepareItems(input);

  const { error } = await supabase
    .from('po_requisitions')
    .update({
      reason: emptyToNull(input.reason),
      remark: emptyToNull(input.remark),
      total_estimate: total,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) throwDbError(error, '更新采购申请单');

  const { error: delErr } = await supabase.from('po_requisition_items').delete().eq('requisition_id', id);
  if (delErr) throwDbError(delErr, '更新申请明细');
  const { error: insErr } = await supabase
    .from('po_requisition_items')
    .insert(items.map((item) => ({ ...item, requisition_id: id })));
  if (insErr) throwDbError(insErr, '更新申请明细');

  return getRequisition(id);
}

export async function deleteRequisition(id: string): Promise<void> {
  const supabase = getSupabaseClient();
  const existing = await getRequisition(id);
  if (existing.status !== 'draft') {
    throw new ApiError(400, 'PO.NOT_DRAFT', '只有草稿状态的申请单可以删除');
  }
  const { error } = await supabase.from('po_requisitions').delete().eq('id', id);
  if (error) throwDbError(error, '删除采购申请单');
}

export async function submitRequisition(id: string, user: SysUser): Promise<RequisitionView> {
  const existing = await getRequisition(id);
  await submitDocument('requisition', id, existing.total_estimate, user);
  return getRequisition(id);
}

export async function approveRequisition(id: string, user: SysUser, comment?: string): Promise<RequisitionView> {
  await approveCurrentStep('requisition', id, user, comment);
  return getRequisition(id);
}

export async function rejectRequisition(id: string, user: SysUser, reason: string): Promise<RequisitionView> {
  await rejectCurrentStep('requisition', id, user, reason);
  return getRequisition(id);
}

/**
 * 申请单转采购订单：approved → 生成 draft 订单（明细/建议价带入）→ 申请单 closed。
 * 一张申请单仅可转一次；价格由调用方按建议价确认后传入（服务端重算金额）。
 */
export async function convertRequisition(
  id: string,
  input: { supplier_id: string; items?: Array<{ product_id: string; quantity: number; unit_price: number }> },
  operatorId: string,
): Promise<PurchaseOrderView> {
  const supabase = getSupabaseClient();
  const existing = await getRequisition(id);
  if (existing.status !== 'approved') {
    throw new ApiError(400, 'PO.BAD_TRANSITION', '仅已审批的申请单可转采购订单');
  }
  if (existing.converted_order_id) {
    throw new ApiError(400, 'PO.ALREADY_CONVERTED', '该申请单已转入采购订单');
  }

  const sourceItems = existing.items ?? [];
  const orderItems = (input.items ?? []).length > 0
    ? input.items!
    : sourceItems.map((i) => ({ product_id: i.product_id, quantity: i.quantity, unit_price: i.suggest_price }));

  const order = await createOrder(
    { supplier_id: input.supplier_id, requisition_id: id, items: orderItems },
    operatorId,
  );

  const { error } = await supabase
    .from('po_requisitions')
    .update({ status: 'closed', converted_order_id: order.id, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throwDbError(error, '关闭申请单');
  return order;
}
