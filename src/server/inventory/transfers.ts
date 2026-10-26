/**
 * 库存调拨单服务端逻辑（inv_transfers / inv_transfer_items）
 *
 * 状态机：draft → pending → approved(在途) → received(已收货)
 *                      ↘ rejected | draft/pending/rejected → closed
 * - 终审通过由 inv_execute_transfer 单事务完成：调出仓 FIFO 扣批次/减现有量、
 *   调入仓在途量（in_transit）增加、双边台账 + 调出均价快照存明细 unit_cost。
 * - 收货由 inv_receive_transfer 单事务完成：调入仓在途 → 现有量 + 批次入库。
 * - 无金额概念，审批规则匹配金额按 0 传（transfer 规则区间 0 ~ 不限）。
 */
import { z } from 'zod';
import { nextDocNo } from '@/server/doc-no';
import { ApiError } from '@/server/http';
import { throwInventoryRpcError } from '@/server/inventory/shared';
import { escapeOrKeyword, throwDbError, type ListQuery, type PagedResult } from '@/server/master-data/helpers';
import { approveCurrentStep, listSteps, rejectCurrentStep, submitDocument, type ApprovalStepView } from '@/server/approval/engine';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import type { InvTransfer, InvTransferItem, SysUser } from '@/storage/database/shared/schema';

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export interface TransferItemView {
  id: string;
  product_id: string;
  product_name: string | null;
  product_sku: string | null;
  unit: string | null;
  quantity: number;
  /** 调出均价快照（终审时写入；审核前为 null） */
  unit_cost: number | null;
}

export interface TransferView {
  id: string;
  transfer_no: string;
  from_warehouse_id: string;
  from_warehouse_name: string | null;
  to_warehouse_id: string;
  to_warehouse_name: string | null;
  status: string;
  transfer_date: string;
  item_count: number;
  total_quantity: number;
  approval_level: number | null;
  current_step: number;
  reject_reason: string | null;
  remark: string | null;
  received_at: string | null;
  created_by_name: string | null;
  created_at: string;
  items?: TransferItemView[];
  steps?: ApprovalStepView[];
}

// ---------------------------------------------------------------------------
// 校验
// ---------------------------------------------------------------------------

const uuid = z.string().regex(/^[0-9a-fA-F-]{36}$/, 'ID 格式不正确');

const itemSchema = z.object({
  product_id: uuid,
  quantity: z.number().positive('数量必须大于 0').max(9_999_999, '数量超出范围'),
});

export const transferCreateSchema = z
  .object({
    from_warehouse_id: uuid,
    to_warehouse_id: uuid,
    transfer_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 YYYY-MM-DD')
      .optional(),
    remark: z.string().max(500, '备注不能超过 500 字').optional(),
    items: z.array(itemSchema).min(1, '至少需要一行明细').max(200, '明细行过多'),
  })
  .refine((v) => v.from_warehouse_id !== v.to_warehouse_id, {
    message: '调出仓与调入仓不能相同',
    path: ['to_warehouse_id'],
  });
export type TransferCreateInput = z.infer<typeof transferCreateSchema>;

export const TRANSFER_STATUSES = ['draft', 'pending', 'approved', 'rejected', 'received', 'closed'] as const;

// ---------------------------------------------------------------------------
// 序列化与辅助
// ---------------------------------------------------------------------------

function toNumber(value: string | number | null): number {
  return value === null ? 0 : Number(value);
}

async function fetchNameMap(
  table: 'md_products' | 'inv_warehouses' | 'sys_users',
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

async function fetchProductSkuUnitMap(ids: (string | null)[]): Promise<Map<string, { sku: string | null; unit: string | null }>> {
  const map = new Map<string, { sku: string | null; unit: string | null }>();
  const uniq = [...new Set(ids.filter((v): v is string => Boolean(v)))];
  if (uniq.length === 0) return map;
  const { data } = await getSupabaseClient().from('md_products').select('id, sku_code, unit').in('id', uniq);
  for (const row of (data ?? []) as Array<{ id: string; sku_code: string | null; unit: string | null }>) {
    map.set(row.id, { sku: row.sku_code, unit: row.unit });
  }
  return map;
}

function serialize(
  row: InvTransfer,
  extra: {
    fromName?: string | null;
    toName?: string | null;
    creatorName?: string | null;
    itemCount?: number;
    totalQty?: number;
    items?: TransferItemView[];
    steps?: ApprovalStepView[];
  } = {},
): TransferView {
  return {
    id: row.id,
    transfer_no: row.transfer_no,
    from_warehouse_id: row.from_warehouse_id,
    from_warehouse_name: extra.fromName ?? null,
    to_warehouse_id: row.to_warehouse_id,
    to_warehouse_name: extra.toName ?? null,
    status: row.status,
    transfer_date: row.transfer_date,
    item_count: extra.itemCount ?? 0,
    total_quantity: extra.totalQty ?? 0,
    approval_level: row.approval_level,
    current_step: row.current_step,
    reject_reason: row.reject_reason,
    remark: row.remark,
    received_at: row.received_at ? new Date(row.received_at).toISOString() : null,
    created_by_name: extra.creatorName ?? null,
    created_at: new Date(row.created_at).toISOString(),
    items: extra.items,
    steps: extra.steps,
  };
}

// ---------------------------------------------------------------------------
// 查询
// ---------------------------------------------------------------------------

interface TransferListQuery extends ListQuery {
  status?: string;
  from_warehouse_id?: string;
  to_warehouse_id?: string;
}

export async function listTransfers(query: TransferListQuery): Promise<PagedResult<TransferView>> {
  const from = (query.page - 1) * query.pageSize;
  const to = from + query.pageSize - 1;

  let req = getSupabaseClient()
    .from('inv_transfers')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(from, to);

  if (query.status) req = req.eq('status', query.status);
  if (query.from_warehouse_id) req = req.eq('from_warehouse_id', query.from_warehouse_id);
  if (query.to_warehouse_id) req = req.eq('to_warehouse_id', query.to_warehouse_id);
  const kw = escapeOrKeyword(query.keyword);
  if (kw) req = req.ilike('transfer_no', `%${kw}%`);

  const { data, error, count } = await req;
  if (error) throwDbError(error, '查询调拨单');

  const rows = (data ?? []) as InvTransfer[];
  const warehouseMap = await fetchNameMap(
    'inv_warehouses',
    rows.flatMap((r) => [r.from_warehouse_id, r.to_warehouse_id]),
  );
  const creatorMap = await fetchNameMap('sys_users', rows.map((r) => r.created_by));

  // 明细汇总（行数与总数量）
  const docIds = rows.map((r) => r.id);
  const aggMap = new Map<string, { count: number; qty: number }>();
  if (docIds.length > 0) {
    const { data: itemRows, error: iErr } = await getSupabaseClient()
      .from('inv_transfer_items')
      .select('transfer_id, quantity')
      .in('transfer_id', docIds);
    if (iErr) throwDbError(iErr, '汇总调拨明细');
    for (const item of itemRows ?? []) {
      const agg = aggMap.get(item.transfer_id as string) ?? { count: 0, qty: 0 };
      agg.count += 1;
      agg.qty += Number(item.quantity ?? 0);
      aggMap.set(item.transfer_id as string, agg);
    }
  }

  const items = rows.map((row) => {
    const agg = aggMap.get(row.id);
    return serialize(row, {
      fromName: warehouseMap.get(row.from_warehouse_id) ?? null,
      toName: warehouseMap.get(row.to_warehouse_id) ?? null,
      creatorName: row.created_by ? (creatorMap.get(row.created_by) ?? null) : null,
      itemCount: agg?.count ?? 0,
      totalQty: agg?.qty ?? 0,
    });
  });

  return { items, total: count ?? 0, page: query.page, page_size: query.pageSize };
}

export async function getTransfer(id: string): Promise<TransferView> {
  const { data, error } = await getSupabaseClient()
    .from('inv_transfers')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throwDbError(error, '查询调拨单');
  if (!data) throw new ApiError(404, 'INV.NOT_FOUND', '调拨单不存在');
  const row = data as InvTransfer;

  const { data: itemRows, error: iErr } = await getSupabaseClient()
    .from('inv_transfer_items')
    .select('*')
    .eq('transfer_id', id)
    .order('created_at', { ascending: true });
  if (iErr) throwDbError(iErr, '查询调拨明细');
  const items = (itemRows ?? []) as InvTransferItem[];

  const warehouseMap = await fetchNameMap('inv_warehouses', [row.from_warehouse_id, row.to_warehouse_id]);
  const productMap = await fetchNameMap('md_products', items.map((it) => it.product_id));
  const skuUnitMap = await fetchProductSkuUnitMap(items.map((it) => it.product_id));
  const creatorMap = await fetchNameMap('sys_users', [row.created_by]);
  const steps = await listSteps('transfer', id);

  return serialize(row, {
    fromName: warehouseMap.get(row.from_warehouse_id) ?? null,
    toName: warehouseMap.get(row.to_warehouse_id) ?? null,
    creatorName: row.created_by ? (creatorMap.get(row.created_by) ?? null) : null,
    itemCount: items.length,
    totalQty: items.reduce((sum, it) => sum + Number(it.quantity), 0),
    items: items.map((it) => ({
      id: it.id,
      product_id: it.product_id,
      product_name: productMap.get(it.product_id) ?? null,
      product_sku: skuUnitMap.get(it.product_id)?.sku ?? null,
      unit: it.unit ?? skuUnitMap.get(it.product_id)?.unit ?? null,
      quantity: toNumber(it.quantity),
      unit_cost: it.unit_cost === null ? null : toNumber(it.unit_cost),
    })),
    steps,
  });
}

// ---------------------------------------------------------------------------
// 写入
// ---------------------------------------------------------------------------

async function assertWarehousesActive(ids: string[]): Promise<void> {
  const uniq = [...new Set(ids)];
  const { data, error } = await getSupabaseClient()
    .from('inv_warehouses')
    .select('id, is_active')
    .in('id', uniq);
  if (error) throwDbError(error, '校验仓库');
  const rows = (data ?? []) as Array<{ id: string; is_active: boolean }>;
  if (rows.length !== uniq.length || rows.some((r) => !r.is_active)) {
    throw new ApiError(400, 'INV.WAREHOUSE_INVALID', '仓库不存在或已停用');
  }
}

export async function createTransfer(input: unknown, user: SysUser): Promise<TransferView> {
  const parsed = transferCreateSchema.safeParse(input);
  if (!parsed.success) {
    throw new ApiError(400, 'INV.VALIDATION', parsed.error.issues[0]?.message ?? '参数错误');
  }
  await assertWarehousesActive([parsed.data.from_warehouse_id, parsed.data.to_warehouse_id]);

  // 单位快照（明细 unit 列）
  const skuUnitMap = await fetchProductSkuUnitMap(parsed.data.items.map((it) => it.product_id));

  const supabase = getSupabaseClient();
  const transferNo = await nextDocNo('IT', 'inv_transfers', 'transfer_no');
  const { data, error } = await supabase
    .from('inv_transfers')
    .insert({
      transfer_no: transferNo,
      from_warehouse_id: parsed.data.from_warehouse_id,
      to_warehouse_id: parsed.data.to_warehouse_id,
      transfer_date: parsed.data.transfer_date ?? new Date().toISOString().slice(0, 10),
      remark: parsed.data.remark ?? null,
      created_by: user.id,
    })
    .select('*')
    .single();
  if (error) throwDbError(error, '创建调拨单');
  const row = data as InvTransfer;

  const { error: iErr } = await supabase.from('inv_transfer_items').insert(
    parsed.data.items.map((it) => ({
      transfer_id: row.id,
      product_id: it.product_id,
      quantity: it.quantity,
      unit: skuUnitMap.get(it.product_id)?.unit ?? null,
    })),
  );
  if (iErr) throwDbError(iErr, '写入调拨明细');
  return getTransfer(row.id);
}

/** 更新（仅 draft/rejected）：整单替换头字段与明细 */
export async function updateTransfer(id: string, input: unknown, _user: SysUser): Promise<TransferView> {
  const doc = await getTransfer(id);
  if (doc.status !== 'draft' && doc.status !== 'rejected') {
    throw new ApiError(400, 'INV.BAD_TRANSITION', '仅草稿或已驳回的调拨单可编辑');
  }
  const parsed = transferCreateSchema.safeParse(input);
  if (!parsed.success) {
    throw new ApiError(400, 'INV.VALIDATION', parsed.error.issues[0]?.message ?? '参数错误');
  }
  await assertWarehousesActive([parsed.data.from_warehouse_id, parsed.data.to_warehouse_id]);
  const skuUnitMap = await fetchProductSkuUnitMap(parsed.data.items.map((it) => it.product_id));

  const supabase = getSupabaseClient();
  const { error: updErr } = await supabase
    .from('inv_transfers')
    .update({
      from_warehouse_id: parsed.data.from_warehouse_id,
      to_warehouse_id: parsed.data.to_warehouse_id,
      transfer_date: parsed.data.transfer_date ?? doc.transfer_date,
      remark: parsed.data.remark ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (updErr) throwDbError(updErr, '更新调拨单');

  const { error: delErr } = await supabase.from('inv_transfer_items').delete().eq('transfer_id', id);
  if (delErr) throwDbError(delErr, '清理旧明细');
  const { error: iErr } = await supabase.from('inv_transfer_items').insert(
    parsed.data.items.map((it) => ({
      transfer_id: id,
      product_id: it.product_id,
      quantity: it.quantity,
      unit: skuUnitMap.get(it.product_id)?.unit ?? null,
    })),
  );
  if (iErr) throwDbError(iErr, '写入调拨明细');
  return getTransfer(id);
}

export async function deleteTransfer(id: string): Promise<void> {
  const doc = await getTransfer(id);
  if (doc.status !== 'draft') {
    throw new ApiError(400, 'INV.BAD_TRANSITION', '仅草稿状态的调拨单可删除');
  }
  const { error } = await getSupabaseClient().from('inv_transfers').delete().eq('id', id);
  if (error) throwDbError(error, '删除调拨单');
}

export async function submitTransfer(id: string, user: SysUser): Promise<TransferView> {
  await submitDocument('transfer', id, 0, user);
  return getTransfer(id);
}

export async function approveTransfer(id: string, user: SysUser, comment?: string): Promise<TransferView> {
  await approveCurrentStep('transfer', id, user, comment);
  return getTransfer(id);
}

export async function rejectTransfer(id: string, user: SysUser, reason: string): Promise<TransferView> {
  await rejectCurrentStep('transfer', id, user, reason);
  return getTransfer(id);
}

/** 收货：approved → received（调入仓在途转现有 + 批次入库） */
export async function receiveTransfer(id: string, user: SysUser): Promise<TransferView> {
  const doc = await getTransfer(id);
  if (doc.status !== 'approved') {
    throw new ApiError(400, 'INV.BAD_TRANSITION', '仅已审（在途）状态的调拨单可收货');
  }
  const { error } = await getSupabaseClient().rpc('inv_receive_transfer', {
    p_transfer_id: id,
    p_user_id: user.id,
  });
  if (error) throwInventoryRpcError(error, '调拨收货');
  return getTransfer(id);
}

/** 关闭（draft/pending/rejected → closed） */
export async function cancelTransfer(id: string, _user: SysUser): Promise<TransferView> {
  const doc = await getTransfer(id);
  if (!['draft', 'pending', 'rejected'].includes(doc.status)) {
    throw new ApiError(400, 'INV.BAD_TRANSITION', '当前状态不可关闭');
  }
  const { error } = await getSupabaseClient()
    .from('inv_transfers')
    .update({ status: 'closed', updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throwDbError(error, '关闭调拨单');
  return getTransfer(id);
}
