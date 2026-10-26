import { ApiError } from '@/server/http';

interface RpcErrorLike {
  message: string;
  code?: string;
  details?: string;
  hint?: string;
}

/**
 * 库存数据库函数（plpgsql）错误映射。
 * 函数内用 RAISE EXCEPTION 'P0001:...' / 'P0400:...' / 'P0404:...' 携带业务码。
 * Supabase RPC 失败时错误通常落在 message 或 details 中。
 */
export function throwInventoryRpcError(error: RpcErrorLike, action: string): never {
  const text = `${error.message ?? ''} ${error.details ?? ''} ${error.hint ?? ''}`;
  if (text.includes('P0001')) {
    const msg = text.match(/P0001:([^"\n]+)/)?.[1]?.trim() ?? '库存不足';
    throw new ApiError(400, 'INV.INSUFFICIENT_STOCK', `${action}失败：${msg}`);
  }
  if (text.includes('P0404')) {
    throw new ApiError(404, 'INV.ORDER_NOT_FOUND', `${action}失败：订单不存在`);
  }
  if (text.includes('P0400')) {
    const msg = text.match(/P0400:([^"\n]+)/)?.[1]?.trim() ?? '当前订单状态不允许该操作';
    throw new ApiError(400, 'INV.BAD_TRANSITION', msg);
  }
  // PG 标准码兜底（check_violation / raise_exception 等）
  if (error.code === '23514' || error.code === 'P0001') {
    throw new ApiError(400, 'INV.INSUFFICIENT_STOCK', `${action}失败：库存不足`);
  }
  throw new ApiError(500, 'INV.RPC_ERROR', `${action}失败: ${error.message}`);
}
