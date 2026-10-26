import { ApiError } from '@/server/http';

export interface ListQuery {
  page: number;
  pageSize: number;
  keyword: string;
}

export interface PagedResult<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

/** 解析分页参数：page 从 1 开始，pageSize 上限 100 */
export function parseListQuery(searchParams: URLSearchParams): ListQuery {
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize')) || 10));
  const keyword = (searchParams.get('keyword') ?? '').trim();
  return { page, pageSize, keyword };
}

/** PostgREST .or() 字符串安全处理：剔除会破坏语法与通配的字符 */
export function escapeOrKeyword(keyword: string): string {
  return keyword.replace(/[%(),."\\]/g, ' ').replace(/\s+/g, ' ').trim();
}

interface DbErrorLike {
  message: string;
  code?: string;
}

/** 统一 DB 错误出口：唯一约束冲突 → 409，其余 → 500 */
export function throwDbError(error: DbErrorLike, action: string): never {
  if (error.code === '23505') {
    throw new ApiError(409, 'MD.DUPLICATE', `${action}失败：编码已存在`);
  }
  throw new ApiError(500, 'MD.DB_ERROR', `${action}失败: ${error.message}`);
}

/** 可选文本字段归一化：空串/undefined → null */
export function emptyToNull(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}
