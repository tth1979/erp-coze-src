/**
 * 库存盘点单服务端逻辑（inv_checks / inv_check_items）
 *
 * 状态机：draft → pending → approved(差异已过账) / rejected；draft/pending/rejected → closed
 * - 建单：按仓库快照当前账面（inv_stock 现有量）生成明细 book_quantity，实盘数默认等于账面。
 * - 编辑（draft/rejected）：仅允许修改各行实盘数量 counted_quantity。
 * - 终审通过由 inv_execute_check 单事务完成：按过账瞬间账面重算差异（实盘−账面），
 *   盘盈入库/盘亏出库（FIFO 扣批次），写台账与明细 difference/unit_cost 快照，可追溯。
 * - 无金额概念，审批规则匹配金额按 0 传（check 规则区间 0 ~ 不限）。
 */
import { z } from 'zod';
import { nextDocNo } from '@/server/doc-no';
import { ApiError } from '@/server/http';
import { escapeOrKeyword, throwDbError, type ListQuery, type PagedResult } from '@/server/master-data/helpers';
import { approveCurrentStep, listSteps, rejectCurrentStep, submitDocument, type ApprovalStepView } from '@/server/approval/engine';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import type { InvCheck, InvCheckItem, SysUser } from '@/storage/database/shared/schema';

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export interface CheckItemView {
  id: string;
  product_id: string;
  product_name: string | null;
  product_sku: string | null;
  unit: string | null;
  book_quantity: number;
  counted_quantity: number;
  /** 差异（过账后为准；过账前按 counted − book 展示预估值） */
  difference: number;
  /** 过账成本快照（过账前为 null） */
  unit_cost: number | null;
  color_code: string | null;
  color_name: string | null;
}

export interface CheckView {
  id: string;
  check_no: string;
  warehouse_id: string;
  warehouse_name: string | null;
  status: string;
  check_date: string;
  item_count: number;
  /** 盘盈行数（差异>0） */
  surplus_count: number;
  /** 盘亏行数（差异<0） */
  shortage_count: number;
  approval_level: number | null;
  current_step: number;
  reject_reason: string | null;
  remark: string | null;
  created_by_name: string | null;
  created_at: string;
  items?: CheckItemView[];
  steps?: ApprovalStepView[];
}

// ---------------------------------------------------------------------------
// 校验
// ---------------------------------------------------------------------------

const uuid = z.string().regex(/^[0-9a-fA-F-]{36}$/, 'ID 格式不正确');

export const checkCreateSchema = z.object({
  warehouse_id: uuid,
  check_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 YYYY-MM-DD')
    .optional(),
  remark: z.string().max(500, '备注不能超过 500 字').optional(),
});
export type CheckCreateInput = z.infer<typeof checkCreateSchema>;

/** 实盘录入（draft/rejected）：整单替换各行实盘数 */
export const checkUpdateSchema = z.object({
  check_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 YYYY-MM-DD')
    .optional(),
  remark: z.string().max(500, '备注不能超过 500 字').optional(),
  items: z
    .array(
      z.object({
        id: uuid,
        counted_quantity: z.number().min(0, '实盘数不能为负').max(9_999_999, '数量超出范围'),
      }),
    )
    .min(1, '至少需要一行明细')
    .max(500, '明细行过多'),
});
export type CheckUpdateInput = z.infer<typeof checkUpdateSchema>;

export const CHECK_STATUSES = ['draft', 'pending', 'approved', 'rejected', 'closed'] as const;

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

function serialize(
  row: InvCheck,
  extra: {
    warehouseName?: string | null;
    creatorName?: string | null;
    itemCount?: number;
    surplusCount?: number;
    shortageCount?: number;
    items?: CheckItemView[];
    steps?: ApprovalStepView[];
  } = {},
): CheckView {
  return {
    id: row.id,
    check_no: row.check_no,
    warehouse_id: row.warehouse_id,
    warehouse_name: extra.warehouseName ?? null,
    status: row.status,
    check_date: row.check_date,
    item_count: extra.itemCount ?? 0,
    surplus_count: extra.surplusCount ?? 0,
    shortage_count: extra.shortageCount ?? 0,
    approval_level: row.approval_level,
    current_step: row.current_step,
    reject_reason: row.reject_reason,
    remark: row.remark,
    created_by_name: extra.creatorName ?? null,
    created_at: new Date(row.created_at).toISOString(),
    items: extra.items,
    steps: extra.steps,
  };
}

// ---------------------------------------------------------------------------
// 查询
// ---------------------------------------------------------------------------

interface CheckListQuery extends ListQuery {
  status?: string;
  warehouse_id?: string;
}

export async function listChecks(query: CheckListQuery): Promise<PagedResult<CheckView>> {
  const from = (query.page - 1) * query.pageSize;
  const to = from + query.pageSize - 1;

  let req = getSupabaseClient()
    .from('inv_checks')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(from, to);

  if (query.status) req = req.eq('status', query.status);
  if (query.warehouse_id) req = req.eq('warehouse_id', query.warehouse_id);
  const kw = escapeOrKeyword(query.keyword);
  if (kw) req = req.ilike('check_no', `%${kw}%`);

  const { data, error, count } = await req;
  if (error) throwDbError(error, '查询盘点单');

  const rows = (data ?? []) as InvCheck[];
  const warehouseMap = await fetchNameMap('inv_warehouses', rows.map((r) => r.warehouse_id));
  const creatorMap = await fetchNameMap('sys_users', rows.map((r) => r.created_by));

  const docIds = rows.map((r) => r.id);
  const aggMap = new Map<string, { count: number; surplus: number; shortage: number }>();
  if (docIds.length > 0) {
    const { data: itemRows, error: iErr } = await getSupabaseClient()
      .from('inv_check_items')
      .select('check_id, difference')
      .in('check_id', docIds);
    if (iErr) throwDbError(iErr, '汇总盘点明细');
    for (const item of itemRows ?? []) {
      const agg = aggMap.get(item.check_id as string) ?? { count: 0, surplus: 0, shortage: 0 };
      agg.count += 1;
      const diff = Number(item.difference ?? 0);
      if (diff > 0) agg.surplus += 1;
      if (diff < 0) agg.shortage += 1;
      aggMap.set(item.check_id as string, agg);
    }
  }

  const items = rows.map((row) => {
    const agg = aggMap.get(row.id);
    return serialize(row, {
      warehouseName: warehouseMap.get(row.warehouse_id) ?? null,
      creatorName: row.created_by ? (creatorMap.get(row.created_by) ?? null) : null,
      itemCount: agg?.count ?? 0,
      surplusCount: agg?.surplus ?? 0,
      shortageCount: agg?.shortage ?? 0,
    });
  });

  return { items, total: count ?? 0, page: query.page, page_size: query.pageSize };
}

export async function getCheck(id: string): Promise<CheckView> {
  const { data, error } = await getSupabaseClient()
    .from('inv_checks')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throwDbError(error, '查询盘点单');
  if (!data) throw new ApiError(404, 'INV.NOT_FOUND', '盘点单不存在');
  const row = data as InvCheck;

  const { data: itemRows, error: iErr } = await getSupabaseClient()
    .from('inv_check_items')
    .select('*')
    .eq('check_id', id)
    .order('created_at', { ascending: true });
  if (iErr) throwDbError(iErr, '查询盘点明细');
  const items = (itemRows ?? []) as InvCheckItem[];

  const warehouseMap = await fetchNameMap('inv_warehouses', [row.warehouse_id]);
  const productMap = await fetchNameMap('md_products', items.map((it) => it.product_id));
  const creatorMap = await fetchNameMap('sys_users', [row.created_by]);
  const steps = await listSteps('check', id);

  const { data: skuRows } = await getSupabaseClient()
    .from('md_products')
    .select('id, sku_code, unit')
    .in('id', [...new Set(items.map((it) => it.product_id))]);
  const skuMap = new Map<string, { sku: string | null; unit: string | null }>();
  for (const p of (skuRows ?? []) as Array<{ id: string; sku_code: string | null; unit: string | null }>) {
    skuMap.set(p.id, { sku: p.sku_code, unit: p.unit });
  }

  const posted = row.status === 'approved';
  const views: CheckItemView[] = items.map((it) => {
    const book = toNumber(it.book_quantity);
    const counted = toNumber(it.counted_quantity);
    return {
      id: it.id,
      product_id: it.product_id,
      product_name: productMap.get(it.product_id) ?? null,
      product_sku: skuMap.get(it.product_id)?.sku ?? null,
      unit: it.unit ?? skuMap.get(it.product_id)?.unit ?? null,
      book_quantity: book,
      counted_quantity: counted,
      difference: posted ? toNumber(it.difference) : counted - book,
      unit_cost: it.unit_cost === null ? null : toNumber(it.unit_cost),
      color_code: (it as InvCheckItem).color_code ?? null,
      color_name: (it as InvCheckItem).color_name ?? null,
    };
  });

  return serialize(row, {
    warehouseName: warehouseMap.get(row.warehouse_id) ?? null,
    creatorName: row.created_by ? (creatorMap.get(row.created_by) ?? null) : null,
    itemCount: views.length,
    surplusCount: views.filter((v) => v.difference > 0).length,
    shortageCount: views.filter((v) => v.difference < 0).length,
    items: views,
    steps,
  });
}

// ---------------------------------------------------------------------------
// 写入
// ---------------------------------------------------------------------------

/** 建单：按仓库快照当前账面库存生成明细（book=现有量，实盘默认=账面） */
export async function createCheck(input: unknown, user: SysUser): Promise<CheckView> {
  const parsed = checkCreateSchema.safeParse(input);
  if (!parsed.success) {
    throw new ApiError(400, 'INV.VALIDATION', parsed.error.issues[0]?.message ?? '参数错误');
  }

  const supabase = getSupabaseClient();
  const { data: wh, error: whErr } = await supabase
    .from('inv_warehouses')
    .select('id, is_active')
    .eq('id', parsed.data.warehouse_id)
    .maybeSingle();
  if (whErr) throwDbError(whErr, '校验仓库');
  if (!wh || !(wh as { is_active: boolean }).is_active) {
    throw new ApiError(400, 'INV.WAREHOUSE_INVALID', '仓库不存在或已停用');
  }

  // 账面快照（按 商品×色号 维度；含零库存行也纳入）
  const { data: stockRows, error: sErr } = await supabase
    .from('inv_stock')
    .select('product_id, color_code, quantity')
    .eq('warehouse_id', parsed.data.warehouse_id);
  if (sErr) throwDbError(sErr, '快照账面库存');
  const snapshot = (stockRows ?? []) as Array<{ product_id: string; color_code: string | null; quantity: string | number }>;

  const checkNo = await nextDocNo('IC', 'inv_checks', 'check_no');
  const { data, error } = await supabase
    .from('inv_checks')
    .insert({
      check_no: checkNo,
      warehouse_id: parsed.data.warehouse_id,
      check_date: parsed.data.check_date ?? new Date().toISOString().slice(0, 10),
      remark: parsed.data.remark ?? null,
      created_by: user.id,
    })
    .select('*')
    .single();
  if (error) throwDbError(error, '创建盘点单');
  const row = data as InvCheck;

  if (snapshot.length > 0) {
    const productIds = snapshot.map((s) => s.product_id);
    const { data: prodRows } = await supabase
      .from('md_products')
      .select('id, unit')
      .in('id', productIds);
    const unitMap = new Map<string, string | null>();
    for (const p of (prodRows ?? []) as Array<{ id: string; unit: string | null }>) {
      unitMap.set(p.id, p.unit);
    }
    // 色号名称快照
    const { data: colorRows } = await supabase
      .from('md_product_colors')
      .select('product_id, color_code, color_name')
      .in('product_id', productIds);
    const colorNameMap = new Map<string, string>();
    for (const c of colorRows ?? []) {
      colorNameMap.set(`${c.product_id as string}|${c.color_code as string}`, c.color_name as string);
    }
    const { error: iErr } = await supabase.from('inv_check_items').insert(
      snapshot.map((s) => {
        const colorCode = (s.color_code ?? '').trim();
        return {
          check_id: row.id,
          product_id: s.product_id,
          book_quantity: Number(s.quantity),
          counted_quantity: Number(s.quantity),
          unit: unitMap.get(s.product_id) ?? null,
          color_code: colorCode,
          color_name: colorCode ? (colorNameMap.get(`${s.product_id}|${colorCode}`) ?? null) : null,
        };
      }),
    );
    if (iErr) throwDbError(iErr, '写入盘点明细');
  }
  return getCheck(row.id);
}

/** 录入实盘（draft/rejected）：按行更新 counted_quantity */
export async function updateCheck(id: string, input: unknown): Promise<CheckView> {
  const doc = await getCheck(id);
  if (doc.status !== 'draft' && doc.status !== 'rejected') {
    throw new ApiError(400, 'INV.BAD_TRANSITION', '仅草稿或已驳回的盘点单可编辑');
  }
  const parsed = checkUpdateSchema.safeParse(input);
  if (!parsed.success) {
    throw new ApiError(400, 'INV.VALIDATION', parsed.error.issues[0]?.message ?? '参数错误');
  }

  const supabase = getSupabaseClient();
  const ownedIds = new Set((doc.items ?? []).map((it) => it.id));
  for (const item of parsed.data.items) {
    if (!ownedIds.has(item.id)) {
      throw new ApiError(400, 'INV.VALIDATION', '明细行不属于该盘点单');
    }
  }

  for (const item of parsed.data.items) {
    const { error } = await supabase
      .from('inv_check_items')
      .update({ counted_quantity: item.counted_quantity })
      .eq('id', item.id);
    if (error) throwDbError(error, '更新实盘数');
  }

  const { error: updErr } = await supabase
    .from('inv_checks')
    .update({
      check_date: parsed.data.check_date ?? doc.check_date,
      remark: parsed.data.remark ?? doc.remark,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (updErr) throwDbError(updErr, '更新盘点单');
  return getCheck(id);
}

export async function deleteCheck(id: string): Promise<void> {
  const doc = await getCheck(id);
  if (doc.status !== 'draft') {
    throw new ApiError(400, 'INV.BAD_TRANSITION', '仅草稿状态的盘点单可删除');
  }
  const { error } = await getSupabaseClient().from('inv_checks').delete().eq('id', id);
  if (error) throwDbError(error, '删除盘点单');
}

export async function submitCheck(id: string, user: SysUser): Promise<CheckView> {
  const doc = await getCheck(id);
  if ((doc.items ?? []).length === 0) {
    throw new ApiError(400, 'INV.VALIDATION', '盘点单无明细，无法提交');
  }
  await submitDocument('check', id, 0, user);
  return getCheck(id);
}

export async function approveCheck(id: string, user: SysUser, comment?: string): Promise<CheckView> {
  await approveCurrentStep('check', id, user, comment);
  return getCheck(id);
}

export async function rejectCheck(id: string, user: SysUser, reason: string): Promise<CheckView> {
  await rejectCurrentStep('check', id, user, reason);
  return getCheck(id);
}

/** 关闭（draft/pending/rejected → closed） */
export async function cancelCheck(id: string, _user: SysUser): Promise<CheckView> {
  const doc = await getCheck(id);
  if (!['draft', 'pending', 'rejected'].includes(doc.status)) {
    throw new ApiError(400, 'INV.BAD_TRANSITION', '当前状态不可关闭');
  }
  const { error } = await getSupabaseClient()
    .from('inv_checks')
    .update({ status: 'closed', updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throwDbError(error, '关闭盘点单');
  return getCheck(id);
}
