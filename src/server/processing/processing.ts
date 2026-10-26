/**
 * 加工管理（ma_*）服务层
 *
 * 加工单(MO) 状态机：draft → pending → approved → completed / closed；rejected 可编辑重提。
 * 复用通用审批引擎（docType='manufacture'，提交按 estimate_cost 定级）。
 * 终审通过即 approved（可执行），随后可【分批领料(issue)】【分批完工(finish)】，
 * 领料/完工由 plpgsql 单事务保证 投入-产出-损耗 数量守恒并分摊成本入成品。
 * 成本雏形：领料按原料移动加权均价结转（issued_cost），完工按未分摊成本分摊入产成品平均价。
 */
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { throwDbError, escapeOrKeyword, type ListQuery, type PagedResult } from '@/server/master-data/helpers';
import { ApiError } from '@/server/http';
import { nextDocNo } from '@/server/doc-no';
import {
  submitDocument,
  approveCurrentStep,
  rejectCurrentStep,
  listSteps,
} from '@/server/approval/engine';
import type { SysUser } from '@/storage/database/shared/schema';

export interface MoItemView {
  id: string;
  mo_id: string;
  line_no: number;
  kind: 'input' | 'output';
  product_id: string;
  product_name: string;
  sku_code: string;
  unit_name: string;
  quantity: number;
  done_quantity: number;
  unit_cost: number;
  warehouse_id: string | null;
}

export interface MaOrderView {
  id: string;
  doc_no: string;
  processing_type: string;
  loss_ratio: number;
  status: string;
  estimate_cost: number;
  issued_cost: number;
  allocated_cost: number;
  remark: string | null;
  approval_level: number;
  current_step: number;
  submitted_by: string | null;
  submitted_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  reject_reason: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  creator_name: string | null;
  input_count: number;
  output_count: number;
  steps: any[];
}

export interface MaInputItem {
  kind: 'input' | 'output';
  product_id: string;
  quantity: number;
}

export interface MaCreateInput {
  processing_type: string;
  loss_ratio?: number;
  items: MaInputItem[];
  remark?: string;
}

export interface MaOrderDetail {
  order: MaOrderView;
  items: MoItemView[];
}

export interface MaListQuery extends ListQuery {
  status?: string;
  processing_type?: string;
}

const ORDER_SET = ['draft', 'pending', 'approved', 'completed', 'closed'];

function serializeOrder(row: Record<string, unknown>): MaOrderView {
  return {
    id: row.id as string,
    doc_no: row.doc_no as string,
    processing_type: row.processing_type as string,
    loss_ratio: Number(row.loss_ratio ?? 0),
    status: row.status as string,
    estimate_cost: Number(row.estimate_cost ?? 0),
    issued_cost: Number(row.issued_cost ?? 0),
    allocated_cost: Number(row.allocated_cost ?? 0),
    remark: (row.remark as string | null) ?? null,
    approval_level: Number(row.approval_level ?? 0),
    current_step: Number(row.current_step ?? 0),
    submitted_by: (row.submitted_by as string | null) ?? null,
    submitted_at: (row.submitted_at as string | null) ?? null,
    approved_by: (row.approved_by as string | null) ?? null,
    approved_at: (row.approved_at as string | null) ?? null,
    reject_reason: (row.reject_reason as string | null) ?? null,
    created_by: (row.created_by as string | null) ?? null,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
    creator_name: null,
    input_count: 0,
    output_count: 0,
    steps: [],
  };
}

function serializeItem(row: Record<string, unknown>): MoItemView {
  return {
    id: row.id as string,
    mo_id: row.mo_id as string,
    line_no: Number(row.line_no ?? 1),
    kind: row.kind as 'input' | 'output',
    product_id: row.product_id as string,
    product_name: (row.product_name as string) ?? '',
    sku_code: (row.sku_code as string) ?? '',
    unit_name: (row.unit_name as string) ?? '',
    quantity: Number(row.quantity ?? 0),
    done_quantity: Number(row.done_quantity ?? 0),
    unit_cost: Number(row.unit_cost ?? 0),
    warehouse_id: (row.warehouse_id as string | null) ?? null,
  };
}

async function listItemsFor(moIds: string[]): Promise<MoItemView[]> {
  if (moIds.length === 0) return [];
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('ma_manufacturing_items')
    .select('*')
    .in('mo_id', moIds)
    .order('line_no', { ascending: true });
  if (error) throwDbError(error, '查询加工明细');
  return (data ?? []).map(serializeItem);
}

async function attachUsers(rows: MaOrderView[]): Promise<void> {
  const ids = Array.from(new Set(rows.map((r) => r.created_by).filter(Boolean))) as string[];
  if (ids.length === 0) return;
  const supabase = getSupabaseClient();
  const { data } = await supabase
    .from('sys_users')
    .select('id, username, display_name')
    .in('id', ids);
  const map = new Map<string, string>();
  for (const u of data ?? []) {
    map.set(u.id, (u.display_name ?? u.username ?? '') as string);
  }
  for (const r of rows) {
    if (r.created_by) r.creator_name = map.get(r.created_by) ?? null;
  }
}

export async function listManufacturing(query: MaListQuery): Promise<PagedResult<MaOrderView>> {
  const supabase = getSupabaseClient();
  let q = supabase.from('ma_manufacturing_orders').select('*', { count: 'exact' });
  if (query.status) q = q.eq('status', query.status);
  if (query.processing_type) q = q.eq('processing_type', query.processing_type);
  if (query.keyword) {
    const k = escapeOrKeyword(query.keyword);
    q = q.or(`doc_no.ilike.%${k}%,remark.ilike.%${k}%`);
  }
  const from = (query.page - 1) * query.pageSize;
  q = q.order('created_at', { ascending: false }).range(from, from + query.pageSize - 1);
  const { data, error, count } = await q;
  if (error) throwDbError(error, '查询加工单');
  const total = count ?? 0;
  const rows: MaOrderView[] = (data ?? []).map((r) =>
    serializeOrder((r as unknown) as Record<string, unknown>),
  );
  const items = await listItemsFor(rows.map((r) => r.id));
  for (const r of rows) {
    const mine = items.filter((i) => i.mo_id === r.id);
    r.input_count = mine.filter((i) => i.kind === 'input').length;
    r.output_count = mine.filter((i) => i.kind === 'output').length;
  }
  await attachUsers(rows);
  return { items: rows, total, page: query.page, page_size: query.pageSize };
}

export async function getManufacturing(id: string): Promise<MaOrderDetail> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('ma_manufacturing_orders')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throwDbError(error, '查询加工单');
  if (!data) throw new ApiError(404, 'MA.NOT_FOUND', '加工单不存在');
  const order = serializeOrder((data as unknown) as Record<string, unknown>);
  await attachUsers([order]);
  const items = await listItems((data as unknown as { id: string }).id);
  // steps
  const steps = await listSteps('manufacture', id).catch(() => []);
  order.steps = steps;
  return { order, items };
}

async function listItems(moId: string): Promise<MoItemView[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('ma_manufacturing_items')
    .select('*')
    .eq('mo_id', moId)
    .order('line_no', { ascending: true });
  if (error) throwDbError(error, '查询加工明细');
  return (data ?? []).map((r) => serializeItem((r as unknown) as Record<string, unknown>));
}

/** 取商品名称/编码/单位快照与参考进价 */
async function fetchProductInfo(productIds: string[]): Promise<
  Map<string, { name: string; sku: string; unit: string; refPrice: number }>
> {
  const uniq = Array.from(new Set(productIds));
  if (uniq.length === 0) return new Map();
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('md_products')
    .select('id, name, sku_code, unit, reference_purchase_price')
    .in('id', uniq);
  if (error) throwDbError(error, '查询商品');
  const map = new Map<string, { name: string; sku: string; unit: string; refPrice: number }>();
  for (const p of data ?? []) {
    map.set(p.id, {
      name: (p.name ?? '') as string,
      sku: (p.sku_code ?? '') as string,
      unit: (p.unit ?? '') as string,
      refPrice: Number(p.reference_purchase_price ?? 0),
    });
  }
  return map;
}

export async function createManufacturing(input: MaCreateInput, user: SysUser): Promise<MaOrderView> {
  if (!input.processing_type) throw new ApiError(400, 'MA.BAD_PARAM', '加工类型必填');
  if (!input.items || input.items.length === 0) {
    throw new ApiError(400, 'MA.BAD_PARAM', '至少需要投入品与产出品');
  }
  const supabase = getSupabaseClient();
  const docNo = await nextDocNo('MA', 'ma_manufacturing_orders', 'doc_no');
  const pids = input.items.map((i) => i.product_id);
  const info = await fetchProductInfo(pids);
  let estimate = 0;
  let lineNo = 0;
  for (const it of input.items) {
    if (!info.has(it.product_id)) throw new ApiError(400, 'MA.BAD_PARAM', '存在无效商品');
    if (Number(it.quantity ?? 0) <= 0) throw new ApiError(400, 'MA.BAD_PARAM', '数量必须大于0');
    lineNo += 1;
    if (it.kind === 'input') estimate += Number(it.quantity) * (info.get(it.product_id)!.refPrice || 0);
  }
  const loss = input.loss_ratio ?? 0.05;
  if (loss < 0 || loss >= 0.6) throw new ApiError(400, 'MA.BAD_PARAM', '损耗比例须在 0~0.6');
  const { data, error } = await supabase
    .from('ma_manufacturing_orders')
    .insert({
      doc_no: docNo,
      processing_type: input.processing_type,
      loss_ratio: loss,
      estimate_cost: Math.round(estimate * 100) / 100,
      status: 'draft',
      remark: input.remark ?? null,
      created_by: user.id,
    })
    .select('*')
    .single();
  if (error) throwDbError(error, '创建加工单');
  const orderId = (data as unknown as { id: string }).id;
  const rows = input.items.map((it, idx) => {
    const p = info.get(it.product_id)!;
    return {
      mo_id: orderId,
      line_no: idx + 1,
      kind: it.kind,
      product_id: it.product_id,
      product_name: p.name,
      sku_code: p.sku,
      unit_name: p.unit,
      quantity: Number(it.quantity),
      unit_cost: it.kind === 'input' ? (p.refPrice || 0) : 0,
      done_quantity: 0,
      warehouse_id: null,
    };
  });
  const { error: iErr } = await supabase.from('ma_manufacturing_items').insert(rows);
  if (iErr) throwDbError(iErr, '保存加工明细');
  const order = serializeOrder((data as unknown) as Record<string, unknown>);
  order.creator_name = user.display_name ?? user.username ?? null;
  return order;
}

export async function updateManufacturing(
  id: string,
  input: MaCreateInput,
  user: SysUser,
): Promise<MaOrderView> {
  const supabase = getSupabaseClient();
  const { data: cur, error: cErr } = await supabase
    .from('ma_manufacturing_orders')
    .select('status')
    .eq('id', id)
    .maybeSingle();
  if (cErr) throwDbError(cErr, '查询加工单');
  if (!cur) throw new ApiError(404, 'MA.NOT_FOUND', '加工单不存在');
  if (cur.status !== 'draft' && cur.status !== 'rejected') {
    throw new ApiError(400, 'MA.BAD_TRANSITION', '仅草稿或已驳回的加工单可编辑');
  }
  const info = await fetchProductInfo(input.items.map((i) => i.product_id));
  let estimate = 0;
  for (const it of input.items) {
    if (it.kind === 'input') estimate += Number(it.quantity) * (info.get(it.product_id)?.refPrice ?? 0);
  }
  const loss = input.loss_ratio ?? 0.05;
  const { error: uErr } = await supabase
    .from('ma_manufacturing_orders')
    .update({
      processing_type: input.processing_type,
      loss_ratio: loss,
      estimate_cost: Math.round(estimate * 100) / 100,
      remark: input.remark ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (uErr) throwDbError(uErr, '更新加工单');
  const { error: dErr } = await supabase.from('ma_manufacturing_items').delete().eq('mo_id', id);
  if (dErr) throwDbError(dErr, '清空旧明细');
  const rows = input.items.map((it, idx) => {
    const p = info.get(it.product_id);
    return {
      mo_id: id,
      line_no: idx + 1,
      kind: it.kind,
      product_id: it.product_id,
      product_name: p?.name ?? '',
      sku_code: p?.sku ?? '',
      unit_name: p?.unit ?? '',
      quantity: Number(it.quantity),
      unit_cost: it.kind === 'input' ? (p?.refPrice ?? 0) : 0,
      done_quantity: 0,
      warehouse_id: null,
    };
  });
  const { error: insErr } = await supabase.from('ma_manufacturing_items').insert(rows);
  if (insErr) throwDbError(insErr, '保存加工明细');
  return getManufacturing(id).then((d) => d.order);
}

export async function deleteManufacturing(id: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('ma_manufacturing_orders')
    .delete()
    .eq('id', id)
    .eq('status', 'draft');
  if (error) throwDbError(error, '删除加工单');
}

export async function submitManufacturing(id: string, user: SysUser): Promise<void> {
  const { order } = await getManufacturing(id);
  await submitDocument('manufacture', id, order.estimate_cost, user);
}

export async function approveManufacturing(id: string, user: SysUser): Promise<void> {
  await approveCurrentStep('manufacture', id, user);
}

export async function rejectManufacturing(id: string, user: SysUser, reason: string): Promise<void> {
  await rejectCurrentStep('manufacture', id, user, reason);
}

export async function closeManufacturing(id: string, user: SysUser): Promise<void> {
  const supabase = getSupabaseClient();
  const { data: cur, error: cErr } = await supabase
    .from('ma_manufacturing_orders')
    .select('status')
    .eq('id', id)
    .maybeSingle();
  if (cErr) throwDbError(cErr, '查询加工单');
  if (!cur) throw new ApiError(404, 'MA.NOT_FOUND', '加工单不存在');
  if (!['draft', 'pending', 'rejected'].includes(cur.status)) {
    throw new ApiError(400, 'MA.BAD_TRANSITION', '当前状态不可关闭');
  }
  const { error } = await supabase
    .from('ma_manufacturing_orders')
    .update({ status: 'closed', updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throwDbError(error, '关闭加工单');
}

function throwMaRpcError(e: { message?: string }, action: string): never {
  const m = (e.message ?? '').toLowerCase();
  if (m.includes('ma_not_found')) throw new ApiError(404, 'MA.NOT_FOUND', `${action}：加工单不存在`);
  if (m.includes('ma_bad_state')) throw new ApiError(400, 'MA.BAD_TRANSITION', `${action}：仅已审加工单可执行`);
  if (m.includes('ma_loss_violation')) throw new ApiError(400, 'MA.LOSS_VIOLATION', `${action}：产出超出损耗允许范围（产出≤投入×(1-损耗)）`);
  if (m.includes('ma_over_issue')) throw new ApiError(400, 'MA.OVER_ISSUE', `${action}：领料超计划投入量`);
  if (m.includes('ma_over_output')) throw new ApiError(400, 'MA.OVER_OUTPUT', `${action}：完工超计划产出量`);
  if (m.includes('p0001') || m.includes('库存不足')) throw new ApiError(400, 'INV.INSUFFICIENT_STOCK', `${action}：原料库存不足`);
  if (m.includes('ma_bad_param')) throw new ApiError(400, 'MA.BAD_PARAM', `${action}：明细参数错误`);
  throw new ApiError(500, 'MA.ERROR', `${action}失败：${e.message}`);
}

export interface MoExecItem {
  product_id: string;
  quantity: number;
}

/** 分批领料：扣原料库存（移动加权均价） */
export async function issueManufacturing(
  id: string,
  warehouseId: string,
  items: MoExecItem[],
  user: SysUser,
): Promise<{ issued_cost: number }> {
  if (!items || items.length === 0) throw new ApiError(400, 'MA.BAD_PARAM', '请选择领料明细');
  const supabase = getSupabaseClient();
  const payload = items.map((i) => ({ product_id: i.product_id, quantity: Number(i.quantity) }));
  const { data, error } = await supabase.rpc('mo_execute_issue', {
    p_mo_id: id,
    p_warehouse_id: warehouseId,
    p_items: payload,
    p_user_id: user.id,
  });
  if (error) throwMaRpcError(error as { message?: string }, '加工领料');
  return { issued_cost: Number(data ?? 0) };
}

/** 分批完工：守恒校验 + 按未分摊成本入库产成品 */
export async function finishManufacturing(
  id: string,
  warehouseId: string,
  items: MoExecItem[],
  user: SysUser,
): Promise<{ allocated_cost: number }> {
  if (!items || items.length === 0) throw new ApiError(400, 'MA.BAD_PARAM', '请选择完工明细');
  const supabase = getSupabaseClient();
  const payload = items.map((i) => ({ product_id: i.product_id, quantity: Number(i.quantity) }));
  const { data, error } = await supabase.rpc('mo_execute_finish', {
    p_mo_id: id,
    p_warehouse_id: warehouseId,
    p_items: payload,
    p_user_id: user.id,
  });
  if (error) throwMaRpcError(error as { message?: string }, '加工完工');
  return { allocated_cost: Number(data ?? 0) };
}