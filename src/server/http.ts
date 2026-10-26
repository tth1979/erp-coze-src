import { NextResponse } from 'next/server';

/** 统一 API 错误 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function ok<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export function fail(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ code, message }, { status });
}

/** 路由统一错误出口 */
export function handleError(error: unknown): NextResponse {
  if (error instanceof ApiError) {
    return fail(error.code, error.message, error.status);
  }
  const message = error instanceof Error ? error.message : '服务器内部错误';
  return fail('SYS.INTERNAL', message, 500);
}
