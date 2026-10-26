import { getSupabaseClient } from '@/storage/database/supabase-client';
import type { MdSupplier } from '@/storage/database/shared/schema';
import { ApiError } from '@/server/http';
import {
  emptyToNull,
  escapeOrKeyword,
  throwDbError,
  type ListQuery,
  type PagedResult,
} from './helpers';

export interface SupplierInput {
  code: string;
  name: string;
  contact?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  tax_no?: string | null;
  settlement?: string | null;
  status?: string;
  remark?: string | null;
}

const TABLE = 'md_suppliers';
const SEARCH_FIELDS = ['name', 'code', 'contact', 'phone'];

function normalize(input: SupplierInput) {
  return {
    code: input.code.trim(),
    name: input.name.trim(),
    contact: emptyToNull(input.contact),
    phone: emptyToNull(input.phone),
    email: emptyToNull(input.email),
    address: emptyToNull(input.address),
    tax_no: emptyToNull(input.tax_no),
    settlement: emptyToNull(input.settlement),
    status: input.status ?? 'active',
    remark: emptyToNull(input.remark),
  };
}

export async function listSuppliers(q: ListQuery): Promise<PagedResult<MdSupplier>> {
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
  if (error) throwDbError(error, '查询供应商');
  return { items: (data ?? []) as MdSupplier[], total: count ?? 0, page: q.page, page_size: q.pageSize };
}

export async function getSupplier(id: string): Promise<MdSupplier> {
  const client = getSupabaseClient();
  const { data, error } = await client.from(TABLE).select('*').eq('id', id).maybeSingle();
  if (error) throwDbError(error, '查询供应商');
  if (!data) throw new ApiError(404, 'MD.NOT_FOUND', '供应商不存在');
  return data as MdSupplier;
}

export async function createSupplier(input: SupplierInput): Promise<MdSupplier> {
  const client = getSupabaseClient();
  const { data, error } = await client.from(TABLE).insert(normalize(input)).select().single();
  if (error) throwDbError(error, '创建供应商');
  return data as MdSupplier;
}

export async function updateSupplier(id: string, input: Partial<SupplierInput>): Promise<MdSupplier> {
  const client = getSupabaseClient();
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const normalized = normalize({ code: '', name: '', ...input } as SupplierInput);
  for (const [key, value] of Object.entries(normalized)) {
    if (input[key as keyof SupplierInput] !== undefined) patch[key] = value;
  }
  const { data, error } = await client.from(TABLE).update(patch).eq('id', id).select().maybeSingle();
  if (error) throwDbError(error, '更新供应商');
  if (!data) throw new ApiError(404, 'MD.NOT_FOUND', '供应商不存在');
  return data as MdSupplier;
}

export async function deleteSupplier(id: string): Promise<void> {
  const client = getSupabaseClient();
  const { data, error } = await client.from(TABLE).delete().eq('id', id).select('id');
  if (error) throwDbError(error, '删除供应商');
  if (!data || data.length === 0) throw new ApiError(404, 'MD.NOT_FOUND', '供应商不存在');
}
