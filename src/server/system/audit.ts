/**
 * 审计日志（sys_audit_logs，只追加不可删——触发器强制）
 * - writeAuditLog：关键操作埋点，失败不阻断业务（仅控制台告警）
 * - listAuditLogs：按用户/操作/资源/时间范围筛选 + 分页（只读）
 */
import { ApiError } from '@/server/http';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { escapeOrKeyword } from '@/server/master-data/helpers';

const TABLE = 'sys_audit_logs';

export interface AuditLogRow {
  id: string;
  user_id: string | null;
  username: string | null;
  display_name: string | null;
  action: string;
  resource: string;
  resource_id: string | null;
  detail: Record<string, unknown> | null;
  ip: string | null;
  operated_at: string;
}

function mapRow(r: Record<string, unknown>, displayName?: string | null): AuditLogRow {
  return {
    id: String(r.id),
    user_id: (r.user_id as string | null) ?? null,
    username: (r.username as string | null) ?? null,
    display_name: displayName ?? null,
    action: String(r.action),
    resource: String(r.resource),
    resource_id: (r.resource_id as string | null) ?? null,
    detail: (r.detail as Record<string, unknown> | null) ?? null,
    ip: (r.ip as string | null) ?? null,
    operated_at: String(r.operated_at),
  };
}

export interface AuditWriteInput {
  userId?: string | null;
  username?: string | null;
  /** 操作标识，如 login / approval.submit / voucher.post / setting.update */
  action: string;
  /** 资源/模块，如 auth / po_order / fin_voucher / sys_setting */
  resource: string;
  resourceId?: string | null;
  detail?: Record<string, unknown> | null;
  ip?: string | null;
}

/** 写审计日志：失败仅告警不抛错（审计不阻断业务主流程） */
export async function writeAuditLog(input: AuditWriteInput): Promise<void> {
  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase.from(TABLE).insert({
      user_id: input.userId ?? null,
      username: input.username ?? null,
      action: input.action,
      resource: input.resource,
      resource_id: input.resourceId ?? null,
      detail: input.detail ?? null,
      ip: input.ip ?? null,
    });
    if (error) console.error('[audit] 写入失败:', error.message);
  } catch (error) {
    console.error('[audit] 写入异常:', error instanceof Error ? error.message : error);
  }
}

export interface AuditListQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  userId?: string;
  /** 操作人模糊（username 匹配） */
  userKeyword?: string;
  action?: string;
  resource?: string;
  from?: string;
  to?: string;
}

export async function listAuditLogs(query: AuditListQuery): Promise<{
  items: AuditLogRow[];
  total: number;
  page: number;
  page_size: number;
}> {
  const supabase = getSupabaseClient();
  const page = query.page && query.page > 0 ? query.page : 1;
  const pageSize = Math.min(query.pageSize && query.pageSize > 0 ? query.pageSize : 20, 100);
  let q = supabase.from(TABLE).select('*', { count: 'exact' });
  if (query.userId) q = q.eq('user_id', query.userId);
  if (query.userKeyword) q = q.ilike('username', `%${escapeOrKeyword(query.userKeyword)}%`);
  if (query.action) q = q.eq('action', query.action);
  if (query.resource) q = q.eq('resource', query.resource);
  if (query.from) q = q.gte('operated_at', `${query.from}T00:00:00Z`);
  if (query.to) q = q.lte('operated_at', `${query.to}T23:59:59.999Z`);
  if (query.keyword) {
    const kw = escapeOrKeyword(query.keyword);
    q = q.or(`username.ilike.%${kw}%,resource_id.ilike.%${kw}%,action.ilike.%${kw}%`);
  }
  const { data, error, count } = await q
    .order('operated_at', { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);
  if (error) throw new ApiError(500, 'SYS.DB', error.message);
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  // 批量补 display_name（两步查询，不依赖嵌入）
  const userIds = [...new Set(rows.map((r) => r.user_id).filter(Boolean))] as string[];
  const nameMap = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: users } = await supabase.from('sys_users').select('id,display_name').in('id', userIds);
    for (const u of users ?? []) {
      const row = u as Record<string, unknown>;
      if (row.display_name) nameMap.set(String(row.id), String(row.display_name));
    }
  }
  return {
    items: rows.map((r) => mapRow(r, r.user_id ? nameMap.get(String(r.user_id)) : null)),
    total: count ?? rows.length,
    page,
    page_size: pageSize,
  };
}

/** 从请求头提取客户端 IP（代理透传优先） */
export function clientIp(request: Request): string | null {
  const headers = request.headers;
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim() ?? null;
  return headers.get('x-real-ip');
}
