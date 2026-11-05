import { getSupabaseClient } from '@/storage/database/supabase-client';
import type { MdCustomer } from '@/storage/database/shared/schema';
import { ApiError } from '@/server/http';
import {
  emptyToNull,
  escapeOrKeyword,
  throwDbError,
  type ListQuery,
  type PagedResult,
} from './helpers';

export interface CustomerInput {
  code: string;
  name: string;
  contact?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  level?: string;
  tax_no?: string | null;
  status?: string;
  remark?: string | null;
  /** 信用额度（0=不启用信用管控） */
  credit_limit?: number | null;
  /** 信用账期（天，0=不计算逾期） */
  credit_days?: number | null;
}

const TABLE = 'md_customers';
const SEARCH_FIELDS = ['name', 'code', 'contact', 'phone'];

function normalize(input: CustomerInput) {
  return {
    code: input.code.trim(),
    name: input.name.trim(),
    contact: emptyToNull(input.contact),
    phone: emptyToNull(input.phone),
    email: emptyToNull(input.email),
    address: emptyToNull(input.address),
    level: input.level ?? 'normal',
    tax_no: emptyToNull(input.tax_no),
    status: input.status ?? 'active',
    remark: emptyToNull(input.remark),
    credit_limit: input.credit_limit ?? 0,
    credit_days: input.credit_days ?? 0,
  };
}

export async function listCustomers(q: ListQuery): Promise<PagedResult<MdCustomer>> {
  const client = getSupabaseClient();
  let query = client.from(TABLE).select('*', { count: 'exact' });
  const kw = escapeOrKeyword(q.keyword);
  if (kw) {
    query = query.or(SEARCH_FIELDS.map((f) => `${f}.ilike.%${kw}%`).join(','));
  }
  const from = (q.page - 1) * q.pageSize;
  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(from, from + q.pageSize - 1);
  if (error) throwDbError(error, '查询客户');
  return { items: (data ?? []) as MdCustomer[], total: count ?? 0, page: q.page, page_size: q.pageSize };
}

export async function getCustomer(id: string): Promise<MdCustomer> {
  const client = getSupabaseClient();
  const { data, error } = await client.from(TABLE).select('*').eq('id', id).maybeSingle();
  if (error) throwDbError(error, '查询客户');
  if (!data) throw new ApiError(404, 'MD.NOT_FOUND', '客户不存在');
  return data as MdCustomer;
}

export async function createCustomer(input: CustomerInput): Promise<MdCustomer> {
  const client = getSupabaseClient();
  const { data, error } = await client.from(TABLE).insert(normalize(input)).select().single();
  if (error) throwDbError(error, '创建客户');
  return data as MdCustomer;
}

export async function updateCustomer(id: string, input: Partial<CustomerInput>): Promise<MdCustomer> {
  const client = getSupabaseClient();
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const normalized = normalize({ code: '', name: '', ...input } as CustomerInput);
  for (const [key, value] of Object.entries(normalized)) {
    if (input[key as keyof CustomerInput] !== undefined) patch[key] = value;
  }
  const { data, error } = await client.from(TABLE).update(patch).eq('id', id).select().maybeSingle();
  if (error) throwDbError(error, '更新客户');
  if (!data) throw new ApiError(404, 'MD.NOT_FOUND', '客户不存在');
  return data as MdCustomer;
}

export async function deleteCustomer(id: string): Promise<void> {
  const client = getSupabaseClient();
  const { data, error } = await client.from(TABLE).delete().eq('id', id).select('id');
  if (error) throwDbError(error, '删除客户');
  if (!data || data.length === 0) throw new ApiError(404, 'MD.NOT_FOUND', '客户不存在');
}
