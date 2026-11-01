/**
 * 系统备份——核心业务表一致性快照。
 * 快照内容真实落库到 sys_backups.payload（jsonb），同时记录每表行数与 sha256 校验和。
 * 恢复为运维操作：提供恢复指引与快照导出，不自动覆盖生产数据。
 */
import crypto from 'node:crypto';
import { ApiError } from '@/server/http';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { nextDocNo } from '@/server/doc-no';
import { writeAuditLog } from './audit';

const TABLE = 'sys_backups';

/** 备份范围分组 → 覆盖表清单（单库全量业务表，按模块分组） */
export const BACKUP_SCOPE_GROUPS: Record<string, string[]> = {
  md: ['md_customers', 'md_suppliers', 'md_products', 'md_units'],
  po: [
    'po_requisitions', 'po_requisition_items',
    'po_purchase_orders', 'po_purchase_order_items',
    'po_receipts', 'po_receipt_items',
    'po_returns', 'po_return_items',
    'po_approval_rules', 'po_approval_rule_steps', 'po_approval_steps',
  ],
  so: [
    'so_sales_orders', 'so_sales_order_items',
    'so_shipments', 'so_shipment_items',
    'so_returns', 'so_return_items',
  ],
  inv: [
    'inv_warehouses', 'inv_stock', 'inv_stock_ledger', 'inv_batches',
    'inv_transfers', 'inv_transfer_items', 'inv_checks', 'inv_check_items',
  ],
  fin: [
    'fin_subjects', 'fin_vouchers', 'fin_voucher_lines', 'fin_voucher_templates',
    'fin_accounting_periods', 'fin_period_logs', 'fin_payments',
    'fin_expense_claims', 'fin_expense_claim_items',
    'fin_bank_statements', 'fin_fixed_assets', 'fin_depreciation_records',
  ],
  tax: ['tax_entries', 'tax_invoices', 'tax_prepaid', 'tax_soc_diff'],
  ma: ['ma_manufacturing_orders', 'ma_manufacturing_items'],
  sys: ['sys_users', 'sys_roles', 'sys_role_permissions', 'sys_user_roles', 'sys_settings'],
  dict: ['dict_system_types', 'dict_system_items'],
};

export const FULL_SCOPE = Object.keys(BACKUP_SCOPE_GROUPS);

export function resolveScopeTables(scope: string[]): { tables: string[]; invalid: string[] } {
  const invalid = scope.filter((g) => !(g in BACKUP_SCOPE_GROUPS));
  const tables = scope.flatMap((g) => BACKUP_SCOPE_GROUPS[g] ?? []);
  return { tables: [...new Set(tables)], invalid };
}

export interface TableStat {
  rows: number;
  sha256: string;
}

/** 纯函数：表行数据的 sha256（稳定序列化：行按 JSON 排序逐行哈希） */
export function tableSha256(rows: Array<Record<string, unknown>>): string {
  const hash = crypto.createHash('sha256');
  const serialized = rows
    .map((r) => JSON.stringify(r, Object.keys(r).sort()))
    .sort();
  for (const line of serialized) hash.update(line).update('\n');
  return hash.digest('hex');
}

/** 纯函数：构造备份 table_stats */
export function buildTableStats(payload: Record<string, Array<Record<string, unknown>>>): Record<string, TableStat> {
  const stats: Record<string, TableStat> = {};
  for (const [table, rows] of Object.entries(payload)) {
    stats[table] = { rows: rows.length, sha256: tableSha256(rows) };
  }
  return stats;
}

/** 纯函数：汇总行数 */
export function totalRowsOf(stats: Record<string, TableStat>): number {
  return Object.values(stats).reduce((s, t) => s + t.rows, 0);
}

const PAGE = 1000;
/** 单表硬上限：防止异常大表撑爆内存（DEV 规模远小于此） */
const MAX_ROWS_PER_TABLE = 50000;

async function fetchAllRows(table: string): Promise<Array<Record<string, unknown>>> {
  const supabase = getSupabaseClient();
  const rows: Array<Record<string, unknown>> = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase.from(table).select('*').range(from, from + PAGE - 1);
    if (error) throw new ApiError(500, 'SYS.DB', `备份读取失败(${table}): ${error.message}`);
    const batch = (data ?? []) as Array<Record<string, unknown>>;
    rows.push(...batch);
    if (batch.length < PAGE) break;
    from += PAGE;
    if (rows.length > MAX_ROWS_PER_TABLE) {
      throw new ApiError(400, 'SYS.BACKUP_TOO_LARGE', `表 ${table} 超过 ${MAX_ROWS_PER_TABLE} 行，请改用数据库层物理备份`);
    }
  }
  return rows;
}

export interface BackupView {
  id: string;
  backup_no: string;
  backup_time: string;
  backup_type: 'full' | 'partial';
  scope: string[];
  status: string;
  operator_id: string | null;
  operator_name: string | null;
  note: string | null;
  table_stats: Record<string, TableStat>;
  total_rows: number;
  size_bytes: number;
  created_at: string;
}

function mapRow(r: Record<string, unknown>): BackupView {
  return {
    id: String(r.id),
    backup_no: String(r.backup_no),
    backup_time: String(r.backup_time),
    backup_type: r.backup_type === 'partial' ? 'partial' : 'full',
    scope: Array.isArray(r.scope) ? (r.scope as string[]) : [],
    status: String(r.status),
    operator_id: (r.operator_id as string | null) ?? null,
    operator_name: (r.operator_name as string | null) ?? null,
    note: (r.note as string | null) ?? null,
    table_stats: (r.table_stats as Record<string, TableStat>) ?? {},
    total_rows: Number(r.total_rows ?? 0),
    size_bytes: Number(r.size_bytes ?? 0),
    created_at: String(r.created_at),
  };
}

/** 触发备份：真实抽取所选范围全部表数据生成快照 */
export async function createBackup(input: {
  backup_type: 'full' | 'partial';
  scope?: string[];
  note?: string | null;
  operator: { id: string; username: string };
  ip?: string | null;
}): Promise<BackupView> {
  const scope = input.backup_type === 'full' ? FULL_SCOPE : (input.scope ?? []);
  if (scope.length === 0) {
    throw new ApiError(400, 'SYS.BAD_PARAM', '按需备份必须指定 scope（表分组）');
  }
  const { tables, invalid } = resolveScopeTables(scope);
  if (invalid.length > 0) {
    throw new ApiError(400, 'SYS.BAD_PARAM', `未知备份分组: ${invalid.join(', ')}；可选: ${FULL_SCOPE.join(', ')}`);
  }
  if (tables.length === 0) {
    throw new ApiError(400, 'SYS.BAD_PARAM', '备份范围为空');
  }

  // 真实抽取快照（失败则记录 failed 行，不伪造成功）
  const payload: Record<string, Array<Record<string, unknown>>> = {};
  const backupNo = await nextDocNo('BK', TABLE, 'backup_no');
  try {
    for (const table of tables) {
      payload[table] = await fetchAllRows(table);
    }
  } catch (e) {
    const supabase = getSupabaseClient();
    await supabase.from(TABLE).insert({
      backup_no: backupNo,
      backup_type: input.backup_type,
      scope,
      status: 'failed',
      operator_id: input.operator.id,
      operator_name: input.operator.username,
      note: input.note ?? null,
      table_stats: {},
      total_rows: 0,
      payload: null,
      size_bytes: 0,
    });
    throw e;
  }

  const tableStats = buildTableStats(payload);
  const totalRows = totalRowsOf(tableStats);
  const sizeBytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from(TABLE)
    .insert({
      backup_no: backupNo,
      backup_type: input.backup_type,
      scope,
      status: 'success',
      operator_id: input.operator.id,
      operator_name: input.operator.username,
      note: input.note ?? null,
      table_stats: tableStats,
      total_rows: totalRows,
      payload,
      size_bytes: sizeBytes,
    })
    .select('id,backup_no,backup_time,backup_type,scope,status,operator_id,operator_name,note,table_stats,total_rows,size_bytes,created_at')
    .single();
  if (error) throw new ApiError(500, 'SYS.DB', `备份记录落库失败: ${error.message}`);

  await writeAuditLog({
    userId: input.operator.id,
    username: input.operator.username,
    action: 'backup.create',
    resource: 'sys_backups',
    resourceId: (data as Record<string, unknown>).id as string,
    detail: { backup_no: backupNo, type: input.backup_type, scope, total_rows: totalRows, size_bytes: sizeBytes },
    ip: input.ip,
  }).catch(() => undefined);

  return mapRow(data as Record<string, unknown>);
}

export interface BackupListQuery {
  page: number;
  pageSize: number;
  backup_type?: string;
  status?: string;
  keyword?: string;
}

export async function listBackups(query: BackupListQuery) {
  const supabase = getSupabaseClient();
  let q = supabase
    .from(TABLE)
    .select('id,backup_no,backup_time,backup_type,scope,status,operator_id,operator_name,note,table_stats,total_rows,size_bytes,created_at', { count: 'exact' })
    .order('backup_time', { ascending: false })
    .range((query.page - 1) * query.pageSize, query.page * query.pageSize - 1);
  if (query.backup_type) q = q.eq('backup_type', query.backup_type);
  if (query.status) q = q.eq('status', query.status);
  if (query.keyword) {
    const kw = query.keyword.replace(/[,%()]/g, '');
    if (kw) q = q.or(`backup_no.ilike.%${kw}%,note.ilike.%${kw}%,operator_name.ilike.%${kw}%`);
  }
  const { data, error, count } = await q;
  if (error) throw new ApiError(500, 'SYS.DB', error.message);
  return {
    items: ((data ?? []) as Array<Record<string, unknown>>).map(mapRow),
    total: count ?? 0,
    page: query.page,
    page_size: query.pageSize,
  };
}

export async function getBackup(id: string): Promise<BackupView> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from(TABLE)
    .select('id,backup_no,backup_time,backup_type,scope,status,operator_id,operator_name,note,table_stats,total_rows,size_bytes,created_at')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new ApiError(500, 'SYS.DB', error.message);
  if (!data) throw new ApiError(404, 'SYS.NOT_FOUND', '备份记录不存在');
  return mapRow(data as Record<string, unknown>);
}

/** 导出快照（下载）：返回 payload 与元信息，供前端存为 .json 文件 */
export async function exportBackupPayload(id: string): Promise<{ meta: BackupView; payload: Record<string, Array<Record<string, unknown>>> }> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from(TABLE).select('*').eq('id', id).maybeSingle();
  if (error) throw new ApiError(500, 'SYS.DB', error.message);
  if (!data) throw new ApiError(404, 'SYS.NOT_FOUND', '备份记录不存在');
  const row = data as Record<string, unknown>;
  if (row.status !== 'success' || !row.payload) {
    throw new ApiError(400, 'SYS.BAD_TRANSITION', '该备份无可用快照（失败或无 payload）');
  }
  return { meta: mapRow(row), payload: row.payload as Record<string, Array<Record<string, unknown>>> };
}

/** 恢复指引（运维手册式说明，不自动执行恢复） */
export const RESTORE_GUIDE = [
  '1. 备份恢复属于高危运维操作，系统不自动覆盖数据，需由 DBA 在数据库层执行。',
  '2. 从备份详情导出快照 JSON（payload 按表分组，含行数与 sha256 校验和）。',
  '3. 恢复前对目标库做一次全量物理备份（pg_dump），确认可回滚。',
  '4. 停写业务（维护模式），按表 TRUNCATE ... CASCADE 后依快照 JSON 逐表 INSERT，或编写 upsert 脚本合并。',
  '5. 恢复后逐项核对 table_stats 中的 rows 与 sha256，确保与快照一致。',
  '6. 执行数据一致性断言跑批（POST /api/system/integrity/run），全部 pass 后方可恢复业务。',
  '7. 审计日志/断言结果/备份记录为只追加表，恢复时不清空，保证留痕连续。',
] as const;
