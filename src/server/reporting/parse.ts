/** 解析报表分组维度（非法值回退默认） */
export function parseGroupBy<T extends string>(
  searchParams: URLSearchParams,
  fallback: T,
  allowed: readonly T[],
): T {
  const value = searchParams.get('groupBy') ?? '';
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}