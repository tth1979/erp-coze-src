/**
 * 期末成本结转批处理（雏形）
 *
 * 在业务终审/完工时已自动生成成本凭证（幂等），本批处理用于期末补生成：
 * - 销售出库（so_shipments status=approved，approved_at 在期间内）→ 未生成销售成本凭证则补生成
 * - 加工完工（ma_manufacturing_orders status=completed，updated_at 在期间内）→ 未生成加工完工成本凭证则补生成
 * 幂等：凭证按 (event_type, event_id) 唯一，重复执行不产生重复凭证。
 */
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { ApiError } from '@/server/http';
import { onSalesShipmentCost, onManufactureFinish, fetchCustomerName } from '@/server/ledger/events';
import { findVoucherByEvent, EVENT_SALES_SHIPMENT_COST, EVENT_MANUFACTURE_FINISH } from '@/server/ledger/ledger';

function periodRange(period: string): { from: string; to: string } {
  if (!/^\d{4}-\d{2}$/.test(period)) throw new ApiError(400, 'TAX.BAD_PERIOD', '期间格式应为 YYYY-MM');
  const [y, m] = period.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  return { from: `${period}-01`, to: `${period}-${String(lastDay).padStart(2, '0')}` };
}

export interface PeriodCloseResult {
  period: string;
  shipment_cost: number;
  manufacture_finish: number;
}

/** 期末补生成成本结转凭证（幂等） */
export async function closePeriodCostTransfer(period: string, operatorId: string): Promise<PeriodCloseResult> {
  if (!operatorId) throw new ApiError(401, 'AUTH.REQUIRED', '未登录');
  const { from, to } = periodRange(period);
  const supabase = getSupabaseClient();

  // 1) 销售出库成本
  let shipmentCost = 0;
  const { data: ships, error: sErr } = await supabase
    .from('so_shipments')
    .select('id, shipment_no, total_cost, customer_id')
    .eq('status', 'approved')
    .gte('approved_at', from)
    .lte('approved_at', `${to}T23:59:59.999Z`);
  if (sErr) throw new ApiError(500, 'DB', sErr.message);
  for (const sh of (ships ?? []) as Record<string, unknown>[]) {
    const id = sh.id as string;
    const existing = await findVoucherByEvent(EVENT_SALES_SHIPMENT_COST, id);
    if (existing) continue;
    if (sh.customer_id) await fetchCustomerName(sh.customer_id as string);
    await onSalesShipmentCost({
      shipment_id: id,
      shipment_no: sh.shipment_no as string,
      cost: Number(sh.total_cost ?? 0),
      operatorId,
      date: (sh.approved_at as string)?.slice(0, 10),
    });
    shipmentCost += 1;
  }

  // 2) 加工完工成本
  let manufactureFinish = 0;
  const { data: mos, error: moErr } = await supabase
    .from('ma_manufacturing_orders')
    .select('id, doc_no, issued_cost, updated_at')
    .eq('status', 'completed')
    .gte('updated_at', from)
    .lte('updated_at', `${to}T23:59:59.999Z`);
  if (moErr) throw new ApiError(500, 'DB', moErr.message);
  for (const mo of (mos ?? []) as Record<string, unknown>[]) {
    const id = mo.id as string;
    const existing = await findVoucherByEvent(EVENT_MANUFACTURE_FINISH, id);
    if (existing) continue;
    await onManufactureFinish({
      order_id: id,
      doc_no: mo.doc_no as string,
      cost: Number(mo.issued_cost ?? 0),
      operatorId,
      date: (mo.updated_at as string)?.slice(0, 10),
    });
    manufactureFinish += 1;
  }

  return { period, shipment_cost: shipmentCost, manufacture_finish: manufactureFinish };
}