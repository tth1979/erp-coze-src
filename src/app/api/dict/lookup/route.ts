import { NextRequest, NextResponse } from 'next/server';
import { handleError, ok } from '@/server/http';
import { requireAuth } from '@/server/auth/guard';
import { lookupDict } from '@/server/dict/dict';
import type { DictItemView } from '@/server/dict/dict';

/** 只读引用：按 type(逗号分隔) 返回活跃字典项映射 { type: items }，供各模块下拉 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    await requireAuth(request);
    const typesParam = request.nextUrl.searchParams.get('types') ?? request.nextUrl.searchParams.get('type') ?? '';
    const codes = typesParam.split(',').map((s) => s.trim()).filter(Boolean);
    const data: Record<string, DictItemView[]> = {};
    for (const code of codes) data[code] = await lookupDict(code);
    return ok({ data });
  } catch (error) {
    return handleError(error);
  }
}