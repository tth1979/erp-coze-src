/**
 * 数据一致性断言跑批——编排层：取数 → 纯函数评估 → 落库（只追加）。
 * 触发方式：手动接口（manual）/ 每日跑批（daily，供日程脚本调用）/ 启动（startup）。
 */
import crypto from 'node:crypto';
import { ApiError } from '@/server/http';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { getSettingRaw } from './settings';
import {
  AssertionReport,
  BatchRow,
  DocNoSource,
  LedgerRow,
  StockStateRow,
  StockValueRow,
  VoucherHead,
  VoucherLineLite,
  evalArApRecon,
  evalBatchClosure,
  evalDocNoUnique,
  evalLedgerConservation,
  evalQuantityState,
  evalValueRecon,
  evalVoucherBalance,
  summarizeRun,
} from './integrity-math';

export type CheckGroup = 'startup' | 'daily' | 'manual';

const TABLE = 'sys_integrity_checks';

function toNum(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

// ---------------------------------------------------------------------------
// 取数
// ---------------------------------------------------------------------------

async function fetchStocks(): Promise<StockValueRow[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('inv_stock')
    .select('product_id,warehouse_id,quantity,frozen_quantity,in_transit,avg_cost,total_cost');
  if (error) throw new ApiError(500, 'SYS.DB', error.message);
  return (data ?? []).map((r: Record<string, unknown>) => ({
    product_id: String(r.product_id),
    warehouse_id: String(r.warehouse_id ?? ''),
    quantity: toNum(r.quantity),
    frozen_quantity: toNum(r.frozen_quantity),
    in_transit: toNum(r.in_transit),
    avg_cost: toNum(r.avg_cost),
    total_cost: toNum(r.total_cost),
  }));
}

async function fetchBatches(): Promise<BatchRow[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('inv_batches')
    .select('product_id,warehouse_id,remaining_quantity,unit_cost');
  if (error) throw new ApiError(500, 'SYS.DB', error.message);
  return (data ?? []).map((r: Record<string, unknown>) => ({
    product_id: String(r.product_id),
    warehouse_id: String(r.warehouse_id ?? ''),
    remaining_quantity: toNum(r.remaining_quantity),
    unit_cost: toNum(r.unit_cost),
  }));
}

async function fetchLedger(): Promise<LedgerRow[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('inv_stock_ledger')
    .select('id,product_id,warehouse_id,quantity,balance,ref_no,created_at')
    .order('created_at', { ascending: true })
    .limit(20000);
  if (error) throw new ApiError(500, 'SYS.DB', error.message);
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: String(r.id),
    product_id: String(r.product_id),
    warehouse_id: String(r.warehouse_id ?? ''),
    quantity: toNum(r.quantity),
    balance: toNum(r.balance),
    ref_no: (r.ref_no as string | null) ?? null,
    created_at: String(r.created_at),
  }));
}

/** 单号收集：各业务主单号（每表一个代表列，全局查重） */
const DOC_NO_SOURCES: Array<{ table: string; column: string }> = [
  { table: 'po_requisitions', column: 'req_no' },
  { table: 'po_purchase_orders', column: 'order_no' },
  { table: 'po_receipts', column: 'receipt_no' },
  { table: 'po_returns', column: 'return_no' },
  { table: 'so_sales_orders', column: 'order_no' },
  { table: 'so_shipments', column: 'shipment_no' },
  { table: 'so_returns', column: 'return_no' },
  { table: 'inv_transfers', column: 'transfer_no' },
  { table: 'inv_checks', column: 'check_no' },
  { table: 'fin_payments', column: 'doc_no' },
  { table: 'fin_expense_claims', column: 'claim_no' },
  { table: 'fin_vouchers', column: 'voucher_no' },
  { table: 'ma_manufacturing_orders', column: 'doc_no' },
  { table: 'fin_fixed_assets', column: 'asset_no' },
];

async function fetchDocNos(): Promise<DocNoSource[]> {
  const supabase = getSupabaseClient();
  const all: DocNoSource[] = [];
  for (const src of DOC_NO_SOURCES) {
    const { data, error } = await supabase.from(src.table).select(src.column).limit(10000);
    if (error) throw new ApiError(500, 'SYS.DB', `收集单号失败(${src.table}): ${error.message}`);
    for (const r of (data ?? []) as unknown as Array<Record<string, unknown>>) {
      const v = r[src.column];
      if (v) all.push({ table: src.table, doc_no: String(v) });
    }
  }
  return all;
}

/** 总账 1405（库存商品）实时余额：期初 + Σ已过账分录(借−贷)，含子级 */
async function fetchGlBalance1405(): Promise<number | null> {
  const supabase = getSupabaseClient();
  const { data: subject, error: sErr } = await supabase
    .from('fin_subjects')
    .select('subject_code, opening_amount, opening_direction')
    .eq('subject_code', '1405')
    .maybeSingle();
  if (sErr) throw new ApiError(500, 'SYS.DB', sErr.message);
  if (!subject) return null;
  const { data, error } = await supabase
    .from('fin_voucher_lines')
    .select('direction, amount, fin_vouchers!inner(status)')
    .like('account_code', '1405%')
    .eq('fin_vouchers.status', 'posted');
  if (error) throw new ApiError(500, 'SYS.DB', error.message);
  const opening = toNum((subject as Record<string, unknown>).opening_amount);
  // opening_direction: 0=借 1=贷（兼容 credit/debit 文本）
  const openingDirRaw = (subject as Record<string, unknown>).opening_direction;
  const openingIsCredit = openingDirRaw === 1 || String(openingDirRaw) === '1' || String(openingDirRaw) === 'credit';
  let balance = openingIsCredit ? -opening : opening;
  let hasMovement = opening !== 0;
  for (const r of data ?? []) {
    hasMovement = true;
    const row = r as Record<string, unknown>;
    const amt = toNum(row.amount);
    const dir = String(row.direction);
    balance += dir === 'd' || dir === 'debit' ? amt : -amt;
  }
  return hasMovement ? Math.round(balance * 100) / 100 : null;
}

async function fetchVouchers(): Promise<{ heads: VoucherHead[]; lines: VoucherLineLite[] }> {
  const supabase = getSupabaseClient();
  const [{ data: heads, error: hErr }, { data: lines, error: lErr }] = await Promise.all([
    supabase.from('fin_vouchers').select('id,voucher_no,status').neq('status', 'void').limit(20000),
    supabase.from('fin_voucher_lines').select('voucher_id,direction,amount').limit(60000),
  ]);
  if (hErr) throw new ApiError(500, 'SYS.DB', hErr.message);
  if (lErr) throw new ApiError(500, 'SYS.DB', lErr.message);
  return {
    heads: (heads ?? []).map((r: Record<string, unknown>) => ({
      id: String(r.id),
      voucher_no: String(r.voucher_no),
      status: String(r.status),
    })),
    lines: (lines ?? []).map((r: Record<string, unknown>) => ({
      voucher_id: String(r.voucher_id),
      direction: String(r.direction),
      amount: toNum(r.amount),
    })),
  };
}

async function fetchArApSnapshot() {
  const supabase = getSupabaseClient();
  const sum = (rows: Array<Record<string, unknown>> | null, col: string) =>
    (rows ?? []).reduce((s, r) => s + toNum(r[col]), 0);
  const [so, soRet, rc, po, poRet, rev, py] = await Promise.all([
    supabase.from('so_sales_orders').select('total_amount').in('status', ['completed', 'shipped']),
    supabase.from('so_returns').select('total_amount').eq('status', 'approved'),
    supabase.from('fin_payments').select('amount').eq('direction', 'receipt').eq('status', 'approved'),
    supabase.from('po_purchase_orders').select('total_amount').in('status', ['completed', 'received']),
    supabase.from('po_returns').select('total_amount').eq('status', 'approved'),
    supabase.from('po_receipts').select('total_amount, reversal_kind').eq('status', 'approved').not('reversal_kind', 'is', null),
    supabase.from('fin_payments').select('amount').eq('direction', 'payment').eq('status', 'approved'),
  ]);
  for (const q of [so, soRet, rc, po, poRet, rev, py]) {
    if (q.error) throw new ApiError(500, 'SYS.DB', q.error.message);
  }
  const reversalNet = ((rev.data ?? []) as Array<Record<string, unknown>>).reduce(
    (s, r) => s + (String(r.reversal_kind) === 'blue' ? 1 : -1) * toNum(r.total_amount),
    0,
  );
  return {
    so_billed: sum(so.data as Array<Record<string, unknown>> | null, 'total_amount'),
    so_returned: sum(soRet.data as Array<Record<string, unknown>> | null, 'total_amount'),
    received: sum(rc.data as Array<Record<string, unknown>> | null, 'amount'),
    po_billed: sum(po.data as Array<Record<string, unknown>> | null, 'total_amount'),
    po_returned: sum(poRet.data as Array<Record<string, unknown>> | null, 'total_amount'),
    po_reversal_net: reversalNet,
    paid: sum(py.data as Array<Record<string, unknown>> | null, 'amount'),
  };
}

// ---------------------------------------------------------------------------
// 严重级别配置：integrity.<check_key>.severity = fail|warn（缺省 fail；货值勾稽缺省 warn）
// ---------------------------------------------------------------------------

async function severityOf(checkKey: string): Promise<'fail' | 'warn'> {
  const raw = await getSettingRaw(`integrity.${checkKey}.severity`);
  if (raw && (raw.value === 'warn' || raw.value === 'fail')) return raw.value;
  return checkKey === 'value_recon' ? 'warn' : 'fail';
}

/** 结账阻断开关（参数中心：integrity.block_period_close，默认 true） */
export async function isBlockPeriodCloseEnabled(): Promise<boolean> {
  const raw = await getSettingRaw('integrity.block_period_close');
  if (!raw) return true;
  return raw.value !== 'false';
}

// ---------------------------------------------------------------------------
// 跑批
// ---------------------------------------------------------------------------

export interface RunResult {
  run_id: string;
  check_group: CheckGroup;
  started_at: string;
  duration_ms: number;
  summary: { total: number; passed: number; warned: number; failed: number; blocking: boolean };
  results: AssertionReport[];
}

export async function runIntegrityChecks(group: CheckGroup): Promise<RunResult> {
  const started = Date.now();
  const [stocks, batches, ledger, docNos, vouchers, arap] = await Promise.all([
    fetchStocks(),
    fetchBatches(),
    fetchLedger(),
    fetchDocNos(),
    fetchVouchers(),
    fetchArApSnapshot(),
  ]);
  const gl1405 = await fetchGlBalance1405();

  const specs: Array<{ key: string; name: string; run: () => ReturnType<typeof evalQuantityState> }> = [
    { key: 'quantity_state', name: '数量四态恒等（可用+锁定=现有，三态非负）', run: () => evalQuantityState(stocks) },
    { key: 'batch_closure', name: '批次成本卡结存恒等（Σ批次余量=库存余额）', run: () => evalBatchClosure(stocks, batches) },
    { key: 'ledger_conservation', name: '台账守恒（prev.balance+chg=balance 且链末=库存）', run: () => evalLedgerConservation(ledger, stocks) },
    { key: 'doc_no_unique', name: '业务单号全局唯一', run: () => evalDocNoUnique(docNos) },
    { key: 'voucher_balance', name: '凭证借贷平衡', run: () => evalVoucherBalance(vouchers.heads, vouchers.lines) },
    { key: 'arap_recon', name: '应收应付对账（单据-已核销-已退 非负闭合）', run: () => evalArApRecon(arap) },
  ];
  const reports: AssertionReport[] = [];
  for (const spec of specs) {
    const severity = await severityOf(spec.key);
    reports.push({ key: spec.key, name: spec.name, severity, ...spec.run() });
  }
  const valueSeverity = await severityOf('value_recon');
  reports.push({
    key: 'value_recon',
    name: '货值口径勾稽（Σqty×avg_cost vs total_cost vs 总账1405）',
    severity: valueSeverity,
    ...evalValueRecon(stocks, gl1405, valueSeverity),
  });

  // 落库（只追加）
  const runId = crypto.randomUUID();
  const supabase = getSupabaseClient();
  const rows = reports.map((r) => ({
    run_id: runId,
    check_group: group,
    check_key: r.key,
    check_name: r.name,
    result: r.result,
    severity: r.severity,
    failure_type: r.failureType ?? null,
    detail: r.detail,
  }));
  const { error } = await supabase.from(TABLE).insert(rows);
  if (error) throw new ApiError(500, 'SYS.DB', `断言结果落库失败: ${error.message}`);

  return {
    run_id: runId,
    check_group: group,
    started_at: new Date(started).toISOString(),
    duration_ms: Date.now() - started,
    summary: summarizeRun(reports),
    results: reports,
  };
}

/** 是否存在 fail 级断言（最近一轮跑批口径），供期末结账阻断调用 */
export async function latestRunHasBlockingFailures(): Promise<{ blocking: boolean; failed: AssertionReport[] }> {
  const result = await runIntegrityChecks('manual');
  const failed = result.results.filter((r) => r.result === 'fail' && r.severity === 'fail');
  return { blocking: failed.length > 0, failed };
}

// ---------------------------------------------------------------------------
// 历史查询
// ---------------------------------------------------------------------------

export interface IntegrityListQuery {
  page: number;
  pageSize: number;
  result?: string;
  check_key?: string;
  check_group?: string;
  keyword?: string;
}

export async function listIntegrityChecks(query: IntegrityListQuery) {
  const supabase = getSupabaseClient();
  let q = supabase
    .from(TABLE)
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range((query.page - 1) * query.pageSize, query.page * query.pageSize - 1);
  if (query.result) q = q.eq('result', query.result);
  if (query.check_key) q = q.eq('check_key', query.check_key);
  if (query.check_group) q = q.eq('check_group', query.check_group);
  if (query.keyword) {
    const kw = query.keyword.replace(/[,%()]/g, '');
    if (kw) q = q.or(`check_name.ilike.%${kw}%,failure_type.ilike.%${kw}%`);
  }
  const { data, error, count } = await q;
  if (error) throw new ApiError(500, 'SYS.DB', error.message);
  return {
    items: (data ?? []) as Array<Record<string, unknown>>,
    total: count ?? 0,
    page: query.page,
    page_size: query.pageSize,
  };
}

/** 断言目录（供前端筛选下拉） */
export const ASSERTION_CATALOG: Array<{ key: string; name: string }> = [
  { key: 'quantity_state', name: '数量四态恒等' },
  { key: 'batch_closure', name: '批次成本卡结存恒等' },
  { key: 'ledger_conservation', name: '台账守恒' },
  { key: 'doc_no_unique', name: '单号全局唯一' },
  { key: 'value_recon', name: '货值口径勾稽' },
  { key: 'voucher_balance', name: '凭证借贷平衡' },
  { key: 'arap_recon', name: '应收应付对账' },
];
