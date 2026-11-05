/**
 * 客户信用服务端逻辑（0023）
 *
 * 口径：
 * - 应收未结 = 已出库(shipped/completed)订单总额 − 已审退货 − 已核销收款（与 fin 应收一致）
 * - 在途占用 = 已确认未出库订单（status=approved）总额
 * - 可用额度 = credit_limit − (应收未结 + 在途占用)
 * - credit_limit = 0 视为不启用信用管控（直接放行）
 * - 校验点：报价转订单 + 销售订单提交审批（确认）
 * - 超限返回 CREDIT.EXCEEDED 阻断；具备 so.approve 权限者可携带 force_reason 强制通过，落审计日志
 *
 * 看板：
 * - 每客户一行：额度/已用/可用/逾期金额/最长逾期天数/状态（绿黄红）
 * - 逾期：应收单 bill_date + credit_days < 今天 → 逾期；金额=该单 outstanding
 */
import { ApiError } from '@/server/http';
import { hasEffectivePermission } from '@/server/auth/permissions';
import { writeAuditLog } from '@/server/system/audit';
import { throwDbError } from '@/server/master-data/helpers';
import { getSupabaseClient } from '@/storage/database/supabase-client';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function toNumber(v: string | number | null): number {
  return v === null ? 0 : Number(v);
}

export interface CreditUsage {
  customer_id: string;
  credit_limit: number;
  credit_days: number;
  /** 应收未结（欠款） */
  ar_outstanding: number;
  /** 已确认未出库订单占用 */
  order_hold: number;
  used: number;
  available: number;
  /** 是否启用信用管控 */
  enabled: boolean;
}

/** 客户信用占用计算（应收未结 + 在途占用） */
export async function customerCreditUsage(customerId: string): Promise<CreditUsage> {
  const supabase = getSupabaseClient();
  const { data: customer, error: cErr } = await supabase
    .from('md_customers')
    .select('id, credit_limit, credit_days')
    .eq('id', customerId)
    .maybeSingle();
  if (cErr) throwDbError(cErr, '查询客户信用');
  if (!customer) throw new ApiError(404, 'MD.NOT_FOUND', '客户不存在');

  const [{ data: shipped, error: sErr }, { data: returns, error: rErr }, { data: receipts, error: pErr }, { data: hold, error: hErr }] =
    await Promise.all([
      // 应收口径与 fin 一致：shipped + completed（历史兼容）
      supabase.from('so_sales_orders').select('total_amount').eq('customer_id', customerId).in('status', ['shipped', 'completed']),
      supabase.from('so_returns').select('total_amount').eq('customer_id', customerId).eq('status', 'approved'),
      supabase.from('fin_payments').select('amount').eq('customer_id', customerId).eq('direction', 'receipt').eq('status', 'approved'),
      // 在途占用：已确认未出库
      supabase.from('so_sales_orders').select('total_amount').eq('customer_id', customerId).eq('status', 'approved'),
    ]);
  if (sErr || rErr || pErr || hErr) throwDbError(sErr ?? rErr ?? pErr ?? hErr ?? { message: 'unknown' }, '统计信用占用');

  const billed = (shipped ?? []).reduce((s, r) => s + toNumber(r.total_amount as string), 0)
    - (returns ?? []).reduce((s, r) => s + toNumber(r.total_amount as string), 0);
  const received = (receipts ?? []).reduce((s, r) => s + toNumber(r.amount as string), 0);
  const orderHold = (hold ?? []).reduce((s, r) => s + toNumber(r.total_amount as string), 0);
  const creditLimit = toNumber(customer.credit_limit as string);
  const used = round2(Math.max(0, billed - received) + orderHold);
  return {
    customer_id: customerId,
    credit_limit: creditLimit,
    credit_days: Number(customer.credit_days ?? 0),
    ar_outstanding: round2(Math.max(0, billed - received)),
    order_hold: round2(orderHold),
    used,
    available: round2(creditLimit - used),
    enabled: creditLimit > 0,
  };
}

export interface CreditCheckContext {
  /** 触发场景（审计 detail 用） */
  scene: 'quote_convert' | 'order_submit';
  /** 关联单据 id/单号 */
  docId?: string;
  docNo?: string;
  /** 强制通过原因（非空且具备 so.approve 权限才允许放行） */
  forceReason?: string | null;
  operator: { id: string; username: string; permissions?: string[] };
  ip?: string | null;
}

/**
 * 信用校验：新增业务金额 applyAmount 计入后，超出可用额度则抛 CREDIT.EXCEEDED。
 * 强制通过：forceReason 非空 + 操作人具备 so.approve 权限 → 放行并落审计（action=credit.override）。
 */
export async function assertCreditAvailable(customerId: string, applyAmount: number, ctx: CreditCheckContext): Promise<void> {
  const usage = await customerCreditUsage(customerId);
  if (!usage.enabled) return; // 未启用信用管控
  const after = round2(usage.used + applyAmount);
  if (after <= usage.credit_limit + 0.0001) return;

  const perms = ctx.operator.permissions ?? [];
  const canOverride = hasEffectivePermission(perms, 'so.approve');
  const reason = (ctx.forceReason ?? '').trim();
  if (canOverride && reason) {
    await writeAuditLog({
      userId: ctx.operator.id,
      username: ctx.operator.username,
      action: 'credit.override',
      resource: ctx.scene === 'quote_convert' ? 'so_quote' : 'so_order',
      resourceId: ctx.docId ?? null,
      detail: {
        scene: ctx.scene,
        doc_no: ctx.docNo ?? null,
        customer_id: customerId,
        apply_amount: round2(applyAmount),
        used_before: usage.used,
        credit_limit: usage.credit_limit,
        over_amount: round2(after - usage.credit_limit),
        force_reason: reason,
      },
      ip: ctx.ip ?? null,
    });
    return;
  }
  throw new ApiError(
    400,
    'CREDIT.EXCEEDED',
    `客户信用额度不足：本次 ${round2(applyAmount)}，已用 ${usage.used}（应收 ${usage.ar_outstanding} + 在途 ${usage.order_hold}），额度 ${usage.credit_limit}，超出 ${round2(after - usage.credit_limit)}`,
  );
}

// ---------------------------------------------------------------------------
// 信用看板
// ---------------------------------------------------------------------------

export interface CreditBoardRow {
  customer_id: string;
  code: string;
  name: string;
  level: string | null;
  credit_limit: number;
  credit_days: number;
  enabled: boolean;
  ar_outstanding: number;
  order_hold: number;
  used: number;
  available: number;
  /** 使用率（enabled=false 时为 null） */
  usage_rate: number | null;
  overdue_amount: number;
  overdue_max_days: number;
  /** green / yellow / red */
  status: 'green' | 'yellow' | 'red';
}

/** 逾期口径：应收单（已出库订单）bill_date + credit_days < 今天 且 outstanding>0 */
export async function creditBoard(keyword?: string): Promise<{ items: CreditBoardRow[] }> {
  const supabase = getSupabaseClient();
  let builder = supabase
    .from('md_customers')
    .select('id, code, name, level, credit_limit, credit_days')
    .eq('status', 'active')
    .order('code', { ascending: true });
  if (keyword && keyword.trim()) {
    const kw = keyword.replace(/[%(),."\\]/g, ' ').trim();
    if (kw) builder = builder.or(`name.ilike.%${kw}%,code.ilike.%${kw}%`);
  }
  const { data: customers, error } = await builder;
  if (error) throwDbError(error, '查询客户信用看板');
  const rows = customers ?? [];
  if (rows.length === 0) return { items: [] };
  const ids = rows.map((r) => r.id as string);

  const [{ data: shipped, error: e1 }, { data: returns, error: e2 }, { data: receipts, error: e3 }, { data: holds, error: e4 }] =
    await Promise.all([
      supabase.from('so_sales_orders').select('id, customer_id, order_date, total_amount').in('customer_id', ids).in('status', ['shipped', 'completed']),
      supabase.from('so_returns').select('customer_id, total_amount').in('customer_id', ids).eq('status', 'approved'),
      supabase.from('fin_payments').select('customer_id, order_id, amount').in('customer_id', ids).eq('direction', 'receipt').eq('status', 'approved'),
      supabase.from('so_sales_orders').select('customer_id, total_amount').in('customer_id', ids).eq('status', 'approved'),
    ]);
  if (e1 || e2 || e3 || e4) throwDbError(e1 ?? e2 ?? e3 ?? e4 ?? { message: 'unknown' }, '统计信用看板');

  const today = new Date().toISOString().slice(0, 10);
  const addDays = (date: string, days: number) => {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };
  const dayDiff = (from: string, to: string) =>
    Math.floor((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000);

  // 每客户聚合
  const billedMap = new Map<string, number>();
  const orderBilled = new Map<string, number>();
  const orderMeta = new Map<string, { customer_id: string; order_date: string; total: number }>();
  for (const o of shipped ?? []) {
    const cid = o.customer_id as string;
    const amt = toNumber(o.total_amount as string);
    billedMap.set(cid, round2((billedMap.get(cid) ?? 0) + amt));
    orderBilled.set(o.id as string, amt);
    orderMeta.set(o.id as string, { customer_id: cid, order_date: o.order_date as string, total: amt });
  }
  for (const r of returns ?? []) {
    const cid = r.customer_id as string;
    billedMap.set(cid, round2((billedMap.get(cid) ?? 0) - toNumber(r.total_amount as string)));
  }
  const receivedMap = new Map<string, number>();
  const orderSettled = new Map<string, number>();
  for (const p of receipts ?? []) {
    const cid = p.customer_id as string;
    const amt = toNumber(p.amount as string);
    receivedMap.set(cid, round2((receivedMap.get(cid) ?? 0) + amt));
    if (p.order_id) orderSettled.set(p.order_id as string, round2((orderSettled.get(p.order_id as string) ?? 0) + amt));
  }
  const holdMap = new Map<string, number>();
  for (const h of holds ?? []) {
    const cid = h.customer_id as string;
    holdMap.set(cid, round2((holdMap.get(cid) ?? 0) + toNumber(h.total_amount as string)));
  }

  const items: CreditBoardRow[] = rows.map((c) => {
    const cid = c.id as string;
    const limit = toNumber(c.credit_limit as string);
    const days = Number(c.credit_days ?? 0);
    const enabled = limit > 0;
    const arOutstanding = round2(Math.max(0, (billedMap.get(cid) ?? 0) - (receivedMap.get(cid) ?? 0)));
    const orderHold = round2(holdMap.get(cid) ?? 0);
    const used = round2(arOutstanding + orderHold);
    const available = round2(limit - used);

    // 逾期：逐应收单核算
    let overdueAmount = 0;
    let overdueMaxDays = 0;
    if (days > 0) {
      for (const [orderId, meta] of orderMeta) {
        if (meta.customer_id !== cid) continue;
        const outstanding = round2(meta.total - (orderSettled.get(orderId) ?? 0));
        if (outstanding <= 0.001) continue;
        const dueDate = addDays(meta.order_date, days);
        if (dueDate < today) {
          overdueAmount = round2(overdueAmount + outstanding);
          overdueMaxDays = Math.max(overdueMaxDays, dayDiff(dueDate, today));
        }
      }
    }

    let status: CreditBoardRow['status'] = 'green';
    if (!enabled) {
      status = 'green';
    } else if (overdueAmount > 0 || available < 0) {
      status = 'red';
    } else if (limit > 0 && used / limit >= 0.8) {
      status = 'yellow';
    }

    return {
      customer_id: cid,
      code: c.code as string,
      name: c.name as string,
      level: (c.level as string | null) ?? null,
      credit_limit: limit,
      credit_days: days,
      enabled,
      ar_outstanding: arOutstanding,
      order_hold: orderHold,
      used,
      available,
      usage_rate: enabled && limit > 0 ? round2((used / limit) * 100) : null,
      overdue_amount: overdueAmount,
      overdue_max_days: overdueMaxDays,
      status,
    };
  });
  return { items };
}

/** 客户信用下钻：该客户应收明细（未结清应收单 + 逾期标记） */
export async function customerCreditDetail(customerId: string): Promise<{
  summary: CreditUsage;
  bills: Array<{
    bill_no: string;
    order_id: string;
    bill_date: string;
    amount: number;
    settled: number;
    outstanding: number;
    due_date: string | null;
    overdue_days: number;
  }>;
}> {
  const supabase = getSupabaseClient();
  const summary = await customerCreditUsage(customerId);
  const { data: orders, error } = await supabase
    .from('so_sales_orders')
    .select('id, order_no, order_date, total_amount')
    .eq('customer_id', customerId)
    .in('status', ['shipped', 'completed'])
    .order('order_date', { ascending: false });
  if (error) throwDbError(error, '查询应收明细');
  const orderIds = (orders ?? []).map((o) => o.id as string);
  const settledMap = new Map<string, number>();
  if (orderIds.length > 0) {
    const { data: pays, error: pErr } = await supabase
      .from('fin_payments')
      .select('order_id, amount')
      .eq('direction', 'receipt')
      .eq('status', 'approved')
      .in('order_id', orderIds);
    if (pErr) throwDbError(pErr, '查询核销明细');
    for (const p of pays ?? []) {
      settledMap.set(p.order_id as string, round2((settledMap.get(p.order_id as string) ?? 0) + toNumber(p.amount as string)));
    }
  }
  const today = new Date().toISOString().slice(0, 10);
  const bills = (orders ?? []).map((o) => {
    const amount = toNumber(o.total_amount as string);
    const settled = settledMap.get(o.id as string) ?? 0;
    const outstanding = round2(amount - settled);
    let dueDate: string | null = null;
    let overdueDays = 0;
    if (summary.credit_days > 0) {
      const d = new Date(`${o.order_date as string}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + summary.credit_days);
      dueDate = d.toISOString().slice(0, 10);
      if (dueDate < today && outstanding > 0.001) {
        overdueDays = Math.floor((new Date(`${today}T00:00:00Z`).getTime() - d.getTime()) / 86_400_000);
      }
    }
    return {
      bill_no: o.order_no as string,
      order_id: o.id as string,
      bill_date: o.order_date as string,
      amount: round2(amount),
      settled: round2(settled),
      outstanding,
      due_date: dueDate,
      overdue_days: overdueDays,
    };
  });
  return { summary, bills: bills.filter((b) => b.outstanding > 0.001) };
}
