/**
 * 固定资产卡片与折旧（fin_fixed_assets + fin_depreciation_records）
 *
 * 口径：
 * - 直线法：月折旧额 = (原值 − 残值) / 使用年限(月)；最后一期兜底剩余应提（净额=残值）。
 * - 月度计提：runDepreciation(period) 对所有「在用且未提足且该期间未提」的资产生成折旧凭证
 *   （借 折旧费用科目 / 贷 1602 累计折旧），记录 fin_depreciation_records，UNIQUE(asset_id,period) 幂等。
 * - 处置：借 累计折旧 + 处置收入/损失（6711 营业外支出）/ 贷 原值 + 处置收益（6301 营业外收入），
 *   凭证幂等（event=asset_disposal, id=资产），处置后状态→disposed 停止折旧。
 * - 删除守卫：已有折旧记录或已处置的资产不可删（400），仅从未计提的草稿态资产可删。
 */
import { z } from 'zod';
import { ApiError } from '@/server/http';
import { emptyToNull, escapeOrKeyword, throwDbError, type ListQuery, type PagedResult } from '@/server/master-data/helpers';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { ensureLeafCodes } from '@/server/finance/leaf-guard';
import { assertPeriodOpen } from '@/server/finance/period-guard';
import { nextDocNo } from '@/server/doc-no';
import { round2 } from '@/server/ledger/balance-math';
import { onDepreciation, onAssetDisposal } from '@/server/ledger/events';
import { findVoucherByEvent, EVENT_DEPRECIATION } from '@/server/ledger/ledger';
import {
  straightLineMonthly,
  periodDepreciation,
  netValue,
} from '@/server/finance/fixed-assets-math';
import type { SysUser } from '@/storage/database/shared/schema';

const ASSET_TABLE = 'fin_fixed_assets';
const DEP_TABLE = 'fin_depreciation_records';

export interface FixedAssetView {
  id: string;
  asset_no: string;
  name: string;
  category: string | null;
  spec: string | null;
  original_value: number;
  depreciation_method: string;
  useful_life: number;
  salvage_value: number;
  acquisition_date: string;
  acquisition_period: string;
  related_subject: string;
  status: string;
  disposal_date: string | null;
  disposal_type: string | null;
  disposal_income: number;
  disposal_reason: string | null;
  disposal_voucher_no: string | null;
  disposed_at: string | null;
  remark: string | null;
  created_at: string;
  // 计算字段（实时）
  accrued: number;          // 累计折旧
  net_value: number;        // 净值 = 原值 − 累计折旧
  months_accrued: number;   // 已计提期数
  monthly_depreciation: number; // 直线法月折旧额
  depreciation_progress: number; // 0-1 已提比例（相对应提额 原值−残值）
}

export interface DepreciationRecordView {
  id: string;
  asset_id: string;
  period: string;
  amount: number;
  voucher_id: string | null;
  voucher_no: string | null;
  created_at: string;
}

export interface FixedAssetDetail extends FixedAssetView {
  records: DepreciationRecordView[];
}

const assetSchema = z.object({
  asset_no: z.string().trim().max(32).optional().nullable(),  // 可自定义编码；缺省自动生成 FAyyyymmdd-NNNN
  name: z.string().trim().min(1, '资产名称不能为空').max(128),
  category: z.string().trim().max(64).optional().nullable(),
  spec: z.string().trim().max(128).optional().nullable(),
  original_value: z.number().positive('原值必须大于 0'),
  useful_life: z.number().int('使用年限须为整数(月)').positive('使用年限必须大于 0'),
  salvage_value: z.number().nonnegative('残值不能为负').optional().default(0),
  acquisition_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '入账日期格式应为 YYYY-MM-DD'),
  related_subject: z.string().trim().max(32).optional().nullable(),
  remark: z.string().trim().max(1000).optional().nullable(),
});
export type FixedAssetInput = z.infer<typeof assetSchema>;

const disposeSchema = z.object({
  disposal_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '处置日期格式应为 YYYY-MM-DD'),
  disposal_type: z.enum(['sell', 'scrap']),
  disposal_income: z.number().nonnegative('处置收入不能为负').optional().default(0),
  disposal_reason: z.string().trim().max(500).optional().nullable(),
});
export type DisposeInput = z.infer<typeof disposeSchema>;

function mapAsset(row: Record<string, unknown>): FixedAssetView {
  const original = Number(row.original_value ?? 0);
  const salvage = Number(row.salvage_value ?? 0);
  const life = Number(row.useful_life ?? 0);
  const accrued = Number(row.accrued ?? 0); // 由查询侧聚合注入
  const months = Number(row.months_accrued ?? 0);
  const depreciable = round2(original - salvage);
  return {
    id: row.id as string,
    asset_no: row.asset_no as string,
    name: row.name as string,
    category: (row.category as string | null) ?? null,
    spec: (row.spec as string | null) ?? null,
    original_value: original,
    depreciation_method: (row.depreciation_method as string) ?? 'straight_line',
    useful_life: life,
    salvage_value: salvage,
    acquisition_date: String(row.acquisition_date ?? '').slice(0, 10),
    acquisition_period: (row.acquisition_period as string) ?? '',
    related_subject: (row.related_subject as string) ?? '6601',
    status: (row.status as string) ?? 'in_use',
    disposal_date: row.disposal_date ? String(row.disposal_date).slice(0, 10) : null,
    disposal_type: (row.disposal_type as string | null) ?? null,
    disposal_income: Number(row.disposal_income ?? 0),
    disposal_reason: (row.disposal_reason as string | null) ?? null,
    disposal_voucher_no: (row.disposal_voucher_no as string | null) ?? null,
    disposed_at: row.disposed_at ? String(row.disposed_at) : null,
    remark: (row.remark as string | null) ?? null,
    created_at: String(row.created_at ?? ''),
    accrued: round2(accrued),
    net_value: netValue(original, accrued),
    months_accrued: months,
    monthly_depreciation: straightLineMonthly({ originalValue: original, salvageValue: salvage, usefulLife: life }),
    depreciation_progress: depreciable > 0 ? Math.min(round2(accrued / depreciable), 1) : 0,
  };
}

function mapRecord(row: Record<string, unknown>): DepreciationRecordView {
  return {
    id: row.id as string,
    asset_id: row.asset_id as string,
    period: row.period as string,
    amount: Number(row.amount ?? 0),
    voucher_id: (row.voucher_id as string | null) ?? null,
    voucher_no: (row.voucher_no as string | null) ?? null,
    created_at: String(row.created_at ?? ''),
  };
}

/** 批量聚合各资产累计折旧 + 已提期数，注入行 */
async function withAccrued<T extends Record<string, unknown>>(rows: T[]): Promise<(T & { accrued: number; months_accrued: number })[]> {
  if (rows.length === 0) return rows.map((r) => ({ ...r, accrued: 0, months_accrued: 0 }));
  const supabase = getSupabaseClient();
  const ids = rows.map((r) => r.id as string);
  const { data, error } = await supabase.from(DEP_TABLE).select('asset_id, amount').in('asset_id', ids);
  if (error) throwDbError(error, '汇总累计折旧');
  const sumMap = new Map<string, { sum: number; cnt: number }>();
  for (const r of data ?? []) {
    const rec = r as Record<string, unknown>;
    const aid = rec.asset_id as string;
    const cur = sumMap.get(aid) ?? { sum: 0, cnt: 0 };
    cur.sum = round2(cur.sum + Number(rec.amount ?? 0));
    cur.cnt += 1;
    sumMap.set(aid, cur);
  }
  return rows.map((r) => {
    const agg = sumMap.get(r.id as string);
    return { ...r, accrued: agg?.sum ?? 0, months_accrued: agg?.cnt ?? 0 };
  });
}

/** 分页列表（keyword=编码/名称、category、status） */
export async function listFixedAssets(
  query: ListQuery,
  filter: { category?: string; status?: string } = {},
): Promise<PagedResult<FixedAssetView>> {
  const supabase = getSupabaseClient();
  let builder = supabase.from(ASSET_TABLE).select('*', { count: 'exact' }).order('created_at', { ascending: false });
  if (filter.category) builder = builder.eq('category', filter.category);
  if (filter.status) builder = builder.eq('status', filter.status);
  if (query.keyword) {
    const kw = escapeOrKeyword(query.keyword);
    if (kw) builder = builder.or(`asset_no.ilike.*${kw}*,name.ilike.*${kw}*`);
  }
  const from = (query.page - 1) * query.pageSize;
  const { data, error, count } = await builder.range(from, from + query.pageSize - 1);
  if (error) throwDbError(error, '查询固定资产列表');
  const rows = await withAccrued((data ?? []) as Record<string, unknown>[]);
  return {
    items: rows.map((r) => mapAsset(r)),
    total: count ?? 0,
    page: query.page,
    page_size: query.pageSize,
  };
}

/** 详情：卡片 + 折旧历史 */
export async function getFixedAssetDetail(id: string): Promise<FixedAssetDetail> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from(ASSET_TABLE).select('*').eq('id', id).maybeSingle();
  if (error) throwDbError(error, '查询固定资产');
  if (!data) throw new ApiError(404, 'FIN.ASSET_NOT_FOUND', '固定资产不存在');
  const [row] = await withAccrued([data as Record<string, unknown>]);
  const { data: recs, error: recErr } = await supabase
    .from(DEP_TABLE)
    .select('*')
    .eq('asset_id', id)
    .order('period', { ascending: true });
  if (recErr) throwDbError(recErr, '查询折旧历史');
  return { ...mapAsset(row), records: (recs ?? []).map((r) => mapRecord(r as Record<string, unknown>)) };
}

/** 新建资产卡片（编码唯一 409） */
export async function createFixedAsset(input: FixedAssetInput, user: SysUser): Promise<FixedAssetDetail> {
  const parsed = assetSchema.parse(input);
  if (parsed.salvage_value >= parsed.original_value) {
    throw new ApiError(400, 'FIN.SALVAGE_TOO_HIGH', '残值必须小于原值');
  }
  const subject = parsed.related_subject?.trim() || '6601';
  await ensureLeafCodes([subject]);
  const supabase = getSupabaseClient();
  const assetNo = parsed.asset_no?.trim() || await nextDocNo('FA', ASSET_TABLE, 'asset_no');
  const period = parsed.acquisition_date.slice(0, 7);
  const { data, error } = await supabase
    .from(ASSET_TABLE)
    .insert({
      asset_no: assetNo,
      name: parsed.name,
      category: emptyToNull(parsed.category ?? null),
      spec: emptyToNull(parsed.spec ?? null),
      original_value: round2(parsed.original_value),
      depreciation_method: 'straight_line',
      useful_life: parsed.useful_life,
      salvage_value: round2(parsed.salvage_value ?? 0),
      acquisition_date: parsed.acquisition_date,
      acquisition_period: period,
      related_subject: subject,
      status: 'in_use',
      remark: emptyToNull(parsed.remark ?? null),
      created_by: user.id,
    })
    .select()
    .maybeSingle();
  if (error) {
    if (/\bfin_fixed_assets_asset_no_key\b|duplicate key/.test(error.message)) {
      throw new ApiError(409, 'FIN.ASSET_NO_DUP', '资产编码已存在');
    }
    throwDbError(error, '新建固定资产');
  }
  return getFixedAssetDetail((data as Record<string, unknown>).id as string);
}

/** 更新资产卡片（仅未计提且未处置可改关键字段） */
export async function updateFixedAsset(id: string, input: Partial<FixedAssetInput>, user: SysUser): Promise<FixedAssetDetail> {
  const detail = await getFixedAssetDetail(id);
  if (detail.status === 'disposed') throw new ApiError(400, 'FIN.ASSET_DISPOSED', '已处置资产不可修改');
  const parsed = assetSchema.partial().parse(input);
  const original = parsed.original_value ?? detail.original_value;
  const salvage = parsed.salvage_value ?? detail.salvage_value;
  if (salvage >= original) throw new ApiError(400, 'FIN.SALVAGE_TOO_HIGH', '残值必须小于原值');
  if (parsed.related_subject) await ensureLeafCodes([parsed.related_subject]);
  // 已计提资产禁止改关键计量字段
  if (detail.months_accrued > 0 && (parsed.original_value !== undefined || parsed.salvage_value !== undefined || parsed.useful_life !== undefined || parsed.acquisition_date !== undefined)) {
    throw new ApiError(400, 'FIN.ASSET_HAS_DEPRECIATION', '已计提折旧的资产不可修改原值/残值/年限/入账日期');
  }
  const supabase = getSupabaseClient();
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (parsed.name !== undefined) patch.name = parsed.name;
  if (parsed.category !== undefined) patch.category = emptyToNull(parsed.category ?? null);
  if (parsed.spec !== undefined) patch.spec = emptyToNull(parsed.spec ?? null);
  if (parsed.original_value !== undefined) patch.original_value = round2(parsed.original_value);
  if (parsed.salvage_value !== undefined) patch.salvage_value = round2(parsed.salvage_value);
  if (parsed.useful_life !== undefined) patch.useful_life = parsed.useful_life;
  if (parsed.acquisition_date !== undefined) {
    patch.acquisition_date = parsed.acquisition_date;
    patch.acquisition_period = parsed.acquisition_date.slice(0, 7);
  }
  if (parsed.related_subject !== undefined) patch.related_subject = parsed.related_subject?.trim() || '6601';
  if (parsed.remark !== undefined) patch.remark = emptyToNull(parsed.remark ?? null);
  const { error } = await supabase.from(ASSET_TABLE).update(patch).eq('id', id);
  if (error) throwDbError(error, '更新固定资产');
  void user;
  return getFixedAssetDetail(id);
}

/** 删除资产：仅未计提且未处置可删 */
export async function deleteFixedAsset(id: string, user: SysUser): Promise<void> {
  const detail = await getFixedAssetDetail(id);
  if (detail.status === 'disposed') throw new ApiError(400, 'FIN.ASSET_DISPOSED', '已处置资产不可删除');
  if (detail.months_accrued > 0) throw new ApiError(400, 'FIN.ASSET_HAS_DEPRECIATION', '已计提折旧的资产不可删除，可选择处置');
  const supabase = getSupabaseClient();
  const { error } = await supabase.from(ASSET_TABLE).delete().eq('id', id);
  if (error) throwDbError(error, '删除固定资产');
  void user;
}

/** 处置资产：生成处置凭证 + 状态置 disposed（幂等） */
export async function disposeFixedAsset(id: string, input: DisposeInput, user: SysUser): Promise<FixedAssetDetail> {
  const parsed = disposeSchema.parse(input);
  const detail = await getFixedAssetDetail(id);
  if (detail.status === 'disposed') throw new ApiError(400, 'FIN.ASSET_DISPOSED', '资产已处置，不可重复处置');
  const disposalPeriod = parsed.disposal_date.slice(0, 7);
  await assertPeriodOpen(disposalPeriod);

  const voucher = await onAssetDisposal({
    asset_id: detail.id,
    asset_no: detail.asset_no,
    asset_name: detail.name,
    original_value: detail.original_value,
    accrued: detail.accrued,
    income: round2(parsed.disposal_income ?? 0),
    operatorId: user.id,
    date: parsed.disposal_date,
  });

  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from(ASSET_TABLE)
    .update({
      status: 'disposed',
      disposal_date: parsed.disposal_date,
      disposal_type: parsed.disposal_type,
      disposal_income: round2(parsed.disposal_income ?? 0),
      disposal_reason: emptyToNull(parsed.disposal_reason ?? null),
      disposal_voucher_no: voucher.voucher_no,
      disposed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) throwDbError(error, '更新处置状态');
  return getFixedAssetDetail(id);
}

/**
 * 月度计提折旧（幂等）：
 * 对所有「在用 + 该期间未提 + 未提足」的资产，按直线法生成折旧凭证并记录。
 * 返回本次计提汇总（已提过的自动跳过）。
 */
export async function runDepreciation(period: string, user: SysUser): Promise<{
  period: string;
  processed: number;
  skipped: number;
  total_amount: number;
  items: { asset_id: string; asset_no: string; asset_name: string; amount: number; voucher_no: string | null; status: 'created' | 'skipped' }[];
}> {
  if (!/^\d{4}-\d{2}$/.test(period)) throw new ApiError(400, 'FIN.BAD_PERIOD', '期间格式应为 YYYY-MM');
  await assertPeriodOpen(period);
  const supabase = getSupabaseClient();
  // 在用资产（入账次月起提：acquisition_period < period 才可提本期）
  const { data, error } = await supabase
    .from(ASSET_TABLE)
    .select('*')
    .eq('status', 'in_use')
    .lt('acquisition_period', period);
  if (error) throwDbError(error, '查询在用资产');
  const assets = (data ?? []) as Record<string, unknown>[];
  const items: { asset_id: string; asset_no: string; asset_name: string; amount: number; voucher_no: string | null; status: 'created' | 'skipped' }[] = [];
  let processed = 0;
  let skipped = 0;
  let total = 0;

  for (const raw of assets) {
    const [row] = await withAccrued([raw]);
    const asset = mapAsset(row);
    // 该期间是否已提
    const { data: exist } = await supabase
      .from(DEP_TABLE)
      .select('id')
      .eq('asset_id', asset.id)
      .eq('period', period)
      .maybeSingle();
    if (exist) {
      skipped += 1;
      continue;
    }
    const amount = periodDepreciation(
      { originalValue: asset.original_value, salvageValue: asset.salvage_value, usefulLife: asset.useful_life },
      asset.months_accrued,
      asset.accrued,
    );
    if (amount <= 0) {
      // 已提足：置状态（幂等），不计入本期
      if (asset.status === 'in_use' && asset.months_accrued >= asset.useful_life) {
        await supabase.from(ASSET_TABLE).update({ status: 'fully_depreciated', updated_at: new Date().toISOString() }).eq('id', asset.id);
      }
      skipped += 1;
      continue;
    }
    // 生成折旧凭证（幂等 event=期间:资产）
    const voucher = await onDepreciation({
      asset_id: asset.id,
      asset_no: asset.asset_no,
      asset_name: asset.name,
      period,
      amount,
      expense_subject: asset.related_subject || '6601',
      operatorId: user.id,
      date: `${period}-28`,
    });
    // 记录折旧明细（UNIQUE 兜底）
    const { error: recErr } = await supabase.from(DEP_TABLE).insert({
      asset_id: asset.id,
      period,
      amount,
      voucher_id: voucher.id,
      voucher_no: voucher.voucher_no,
      created_by: user.id,
    });
    if (recErr) {
      if (!/fin_depreciation_records_uniq|duplicate key/.test(recErr.message)) throwDbError(recErr, '记录折旧明细');
      skipped += 1;
      continue;
    }
    // 提足则更新状态
    const newAccrued = round2(asset.accrued + amount);
    const newMonths = asset.months_accrued + 1;
    if (newMonths >= asset.useful_life || newAccrued >= round2(asset.original_value - asset.salvage_value)) {
      await supabase.from(ASSET_TABLE).update({ status: 'fully_depreciated', updated_at: new Date().toISOString() }).eq('id', asset.id);
    }
    processed += 1;
    total = round2(total + amount);
    items.push({ asset_id: asset.id, asset_no: asset.asset_no, asset_name: asset.name, amount, voucher_no: voucher.voucher_no, status: 'created' });
  }
  return { period, processed, skipped, total_amount: total, items };
}

/** 折旧历史（可按期间/资产过滤），含资产名称 */
export async function listDepreciationRecords(
  query: ListQuery,
  filter: { period?: string; asset_id?: string } = {},
): Promise<PagedResult<DepreciationRecordView & { asset_no: string; asset_name: string }>> {
  const supabase = getSupabaseClient();
  let builder = supabase.from(DEP_TABLE).select('*', { count: 'exact' }).order('period', { ascending: false });
  if (filter.period) builder = builder.eq('period', filter.period);
  if (filter.asset_id) builder = builder.eq('asset_id', filter.asset_id);
  const from = (query.page - 1) * query.pageSize;
  const { data, error, count } = await builder.range(from, from + query.pageSize - 1);
  if (error) throwDbError(error, '查询折旧历史');
  const recs = (data ?? []) as Record<string, unknown>[];
  // 批量补资产编号/名称
  const assetIds = [...new Set(recs.map((r) => r.asset_id as string))];
  const nameMap = new Map<string, { no: string; name: string }>();
  if (assetIds.length > 0) {
    const { data: assets } = await supabase.from(ASSET_TABLE).select('id, asset_no, name').in('id', assetIds);
    for (const a of assets ?? []) {
      const ar = a as Record<string, unknown>;
      nameMap.set(ar.id as string, { no: ar.asset_no as string, name: ar.name as string });
    }
  }
  return {
    items: recs.map((r) => {
      const a = nameMap.get(r.asset_id as string);
      return { ...mapRecord(r), asset_no: a?.no ?? '', asset_name: a?.name ?? '' };
    }),
    total: count ?? 0,
    page: query.page,
    page_size: query.pageSize,
  };
}

/** 折旧凭证查询（按期间+资产取凭证号，用于幂等校验/展示） */
export async function findDepreciationVoucher(period: string, assetId: string) {
  return findVoucherByEvent(EVENT_DEPRECIATION, `${period}:${assetId}`);
}
