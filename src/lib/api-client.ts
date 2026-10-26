/** 统一请求层：JSON 编解码 + 错误规整；业务侧不再各自 try/catch 401 */
export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const json: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const err = json as { code?: string; message?: string } | null;
    throw new ApiClientError(
      response.status,
      err?.code ?? 'SYS.UNKNOWN',
      err?.message ?? `请求失败（${response.status}）`,
    );
  }
  return json as T;
}
