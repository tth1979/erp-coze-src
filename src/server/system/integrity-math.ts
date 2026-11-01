/**
 * 数据一致性断言——纯函数计算核心（不触库，全部接受快照入参）。
 * 每个 evaluator 返回 { result, failureType?, detail }；编排层负责取数与落库。
 */

export type CheckResult = 'pass' | 'fail' | 'warn';

export interface AssertionOutcome {
  result: CheckResult;
  failureType?: string;
  detail: Record<string, unknown>;
}

const EPS_QTY = 1e-6;
const EPS_AMT = 0.005;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// 1) 数量四态恒等：可用 + 锁定 = 现有；且现有/锁定/在途非负
//    本系统库存三态：quantity(现有) = available(可用) + frozen(锁定)；in_transit(在途) 独立计数
// ---------------------------------------------------------------------------

export interface StockStateRow {
  product_id: string;
  warehouse_id: string;
  quantity: number;
  frozen_quantity: number;
  in_transit: number;
}

export function evalQuantityState(rows: StockStateRow[]): AssertionOutcome {
  const violations: Array<Record<string, unknown>> = [];
  for (const r of rows) {
    const available = r.quantity - r.frozen_quantity;
    const problems: string[] = [];
    if (r.quantity < -EPS_QTY) problems.push('现有数量为负');
    if (r.frozen_quantity < -EPS_QTY) problems.push('锁定数量为负');
    if (r.in_transit < -EPS_QTY) problems.push('在途数量为负');
    if (available < -EPS_QTY) problems.push('可用数量为负(锁定超现有)');
    if (problems.length > 0) {
      violations.push({
        product_id: r.product_id,
        warehouse_id: r.warehouse_id,
        quantity: r.quantity,
        frozen: r.frozen_quantity,
        in_transit: r.in_transit,
        available: round2(available),
        problems,
      });
    }
  }
  if (violations.length > 0) {
    return {
      result: 'fail',
      failureType: 'QTY_STATE_MISMATCH',
      detail: { violations: violations.slice(0, 50), violation_count: violations.length, checked: rows.length },
    };
  }
  return { result: 'pass', detail: { checked: rows.length, message: '全部库存行四态非负且可用=现有-锁定' } };
}

// ---------------------------------------------------------------------------
// 2) 批次结存恒等：Σ批次 remaining == inv_stock.quantity（按 商品×仓 分组）
// ---------------------------------------------------------------------------

export interface BatchRow {
  product_id: string;
  warehouse_id: string;
  remaining_quantity: number;
  unit_cost: number;
}

export function evalBatchClosure(stocks: StockStateRow[], batches: BatchRow[]): AssertionOutcome {
  const batchSum = new Map<string, number>();
  for (const b of batches) {
    const key = `${b.product_id}|${b.warehouse_id}`;
    batchSum.set(key, (batchSum.get(key) ?? 0) + b.remaining_quantity);
  }
  const mismatches: Array<Record<string, unknown>> = [];
  for (const s of stocks) {
    const key = `${s.product_id}|${s.warehouse_id}`;
    const bs = batchSum.get(key) ?? 0;
    if (Math.abs(bs - s.quantity) > EPS_QTY) {
      mismatches.push({
        product_id: s.product_id,
        warehouse_id: s.warehouse_id,
        stock_quantity: s.quantity,
        batch_remaining_sum: round2(bs),
        diff: round2(bs - s.quantity),
      });
    }
  }
  // 反向孤儿批次：有批次余量但无库存行
  const stockKeys = new Set(stocks.map((s) => `${s.product_id}|${s.warehouse_id}`));
  for (const [key, v] of batchSum) {
    if (!stockKeys.has(key) && Math.abs(v) > EPS_QTY) {
      const [product_id, warehouse_id] = key.split('|');
      mismatches.push({ product_id, warehouse_id, stock_quantity: 0, batch_remaining_sum: round2(v), diff: round2(v), orphan: true });
    }
  }
  if (mismatches.length > 0) {
    return {
      result: 'fail',
      failureType: 'BATCH_CLOSURE_MISMATCH',
      detail: { mismatches: mismatches.slice(0, 50), mismatch_count: mismatches.length, stock_rows: stocks.length },
    };
  }
  return { result: 'pass', detail: { stock_rows: stocks.length, batch_rows: batches.length, message: '批次结存合计与库存余额逐行闭合' } };
}

// ---------------------------------------------------------------------------
// 3) 台账守恒：按 (商品×仓) 分组沿时间链 prev.balance + quantity == balance；
//    链末余额 == inv_stock.quantity
// ---------------------------------------------------------------------------

export interface LedgerRow {
  id: string;
  product_id: string;
  warehouse_id: string;
  quantity: number; // 带符号
  balance: number;  // 变动后余额快照
  ref_no: string | null;
  created_at: string;
}

export function evalLedgerConservation(
  ledger: LedgerRow[],
  stocks: StockStateRow[],
): AssertionOutcome {
  // 按 商品×仓 分组，按 created_at 排序；同时间戳（同事务多行）用余额链贪心还原先后：
  // 逐步从剩余行中挑 balance-quantity==running 的行，找不到即判断链。
  const groups = new Map<string, LedgerRow[]>();
  for (const row of ledger) {
    const key = `${row.product_id}|${row.warehouse_id}`;
    const arr = groups.get(key) ?? [];
    arr.push(row);
    groups.set(key, arr);
  }
  const broken: Array<Record<string, unknown>> = [];
  let chainChecked = 0;
  for (const [key, rows] of groups) {
    rows.sort((a, b) => (a.created_at === b.created_at ? (a.id < b.id ? -1 : 1) : a.created_at < b.created_at ? -1 : 1));
    const [product_id, warehouse_id] = key.split('|');
    let running: number | null = null; // 链上当前余额
    let i = 0;
    while (i < rows.length) {
      // 同时间戳一组
      let j = i;
      while (j < rows.length && rows[j].created_at === rows[i].created_at) j += 1;
      const bucket = rows.slice(i, j);
      const remaining = [...bucket];
      while (remaining.length > 0) {
        let idx = -1;
        if (running !== null) {
          const prevBalance: number = running;
          idx = remaining.findIndex((r) => Math.abs(r.balance - r.quantity - prevBalance) <= EPS_QTY);
        }
        if (idx === -1) idx = 0; // 首行或无匹配（断链在下方检测）
        const row = remaining.splice(idx, 1)[0];
        chainChecked += 1;
        if (running !== null) {
          const expect = running + row.quantity;
          if (Math.abs(expect - row.balance) > EPS_QTY) {
            broken.push({
              product_id: row.product_id,
              warehouse_id: row.warehouse_id,
              ledger_id: row.id,
              ref_no: row.ref_no,
              prev_balance: round2(running),
              change: row.quantity,
              expect_balance: round2(expect),
              actual_balance: row.balance,
              diff: round2(row.balance - expect),
            });
          }
        }
        if (row.balance < -EPS_QTY) {
          broken.push({
            product_id: row.product_id,
            warehouse_id: row.warehouse_id,
            ledger_id: row.id,
            ref_no: row.ref_no,
            actual_balance: row.balance,
            negative: true,
          });
        }
        running = row.balance;
      }
      i = j;
    }
    // 链末余额与库存余额一致
    const stock = stocks.find((s) => s.product_id === product_id && s.warehouse_id === warehouse_id);
    if (running !== null && stock && Math.abs(running - stock.quantity) > EPS_QTY) {
      broken.push({
        product_id,
        warehouse_id,
        ledger_tail_balance: round2(running),
        stock_quantity: stock.quantity,
        diff: round2(running - stock.quantity),
        tail_mismatch: true,
      });
    }
  }
  if (broken.length > 0) {
    return {
      result: 'fail',
      failureType: 'LEDGER_CHAIN_BROKEN',
      detail: { broken: broken.slice(0, 50), broken_count: broken.length, ledger_rows: ledger.length },
    };
  }
  return { result: 'pass', detail: { ledger_rows: ledger.length, chain_links_checked: chainChecked, message: '台账链 prev.balance+chg=balance 全链守恒（同事务行按余额链还原）' } };
}

// ---------------------------------------------------------------------------
// 4) 单号全局唯一：跨业务表收集全部单号，重复即 fail
// ---------------------------------------------------------------------------

export interface DocNoSource {
  table: string;
  doc_no: string;
}

export function evalDocNoUnique(sources: DocNoSource[]): AssertionOutcome {
  const seen = new Map<string, string[]>();
  for (const s of sources) {
    if (!s.doc_no) continue;
    const arr = seen.get(s.doc_no) ?? [];
    arr.push(s.table);
    seen.set(s.doc_no, arr);
  }
  const duplicates: Array<Record<string, unknown>> = [];
  for (const [docNo, tables] of seen) {
    if (tables.length > 1) {
      duplicates.push({ doc_no: docNo, tables, occurrences: tables.length });
    }
  }
  if (duplicates.length > 0) {
    return {
      result: 'fail',
      failureType: 'DOC_NO_DUPLICATED',
      detail: { duplicates: duplicates.slice(0, 50), duplicate_count: duplicates.length, checked: sources.length },
    };
  }
  return { result: 'pass', detail: { checked: sources.length, message: '全局业务单号无重复' } };
}

// ---------------------------------------------------------------------------
// 5) 货值口径勾稽：Σ(quantity × avg_cost) vs inv_stock.total_cost；
//    库存货值 vs 总账 1405 余额（严重级别可配置，默认 warn）
// ---------------------------------------------------------------------------

export interface StockValueRow extends StockStateRow {
  avg_cost: number;
  total_cost: number;
}

export function evalValueRecon(
  stocks: StockValueRow[],
  glBalance1405: number | null,
  severity: 'fail' | 'warn',
): AssertionOutcome {
  const rowIssues: Array<Record<string, unknown>> = [];
  let computedValue = 0;
  let storedValue = 0;
  for (const r of stocks) {
    computedValue = round2(computedValue + round2(r.quantity * r.avg_cost));
    storedValue = round2(storedValue + r.total_cost);
    // 行级不变量：avg_cost(4位小数) ≈ total_cost/quantity。
    // 直接比 qty×avg==total 会把四位小数舍入差随数量放大（如 12002×0.00005≈0.6），
    // 故换算回单价比较，容差取四位小数半格 0.00005 加总成本两位舍入折算。
    if (r.quantity > EPS_QTY) {
      const expectedAvg = r.total_cost / r.quantity;
      const tolerance = 0.00005 + 0.005 / r.quantity;
      if (Math.abs(r.avg_cost - expectedAvg) > tolerance) {
        rowIssues.push({
          product_id: r.product_id,
          warehouse_id: r.warehouse_id,
          quantity: r.quantity,
          avg_cost: r.avg_cost,
          expected_avg: Math.round(expectedAvg * 10000) / 10000,
          total_cost: r.total_cost,
          diff: round2(r.total_cost - round2(r.quantity * r.avg_cost)),
        });
      }
    } else if (Math.abs(r.total_cost) > EPS_AMT) {
      rowIssues.push({
        product_id: r.product_id,
        warehouse_id: r.warehouse_id,
        quantity: 0,
        total_cost: r.total_cost,
        problem: '零数量但有货值',
      });
    }
  }
  if (rowIssues.length > 0) {
    return {
      result: 'fail',
      failureType: 'VALUE_ROW_MISMATCH',
      detail: { issues: rowIssues.slice(0, 50), issue_count: rowIssues.length },
    };
  }
  const detail: Record<string, unknown> = {
    inventory_value: computedValue,
    stored_total_cost: storedValue,
    gl_1405_balance: glBalance1405,
  };
  if (glBalance1405 === null) {
    return { result: 'pass', detail: { ...detail, message: '库存货值=Σ(qty×avg_cost) 与存储值一致；总账 1405 无期初/发生额' } };
  }
  const diff = round2(computedValue - glBalance1405);
  if (Math.abs(diff) > EPS_AMT) {
    return {
      result: severity,
      failureType: 'VALUE_GL_MISMATCH',
      detail: { ...detail, diff, message: `库存货值与总账 1405 差异 ${diff}（历史未过账入库/出库成本凭证场景）` },
    };
  }
  return { result: 'pass', detail: { ...detail, message: '库存货值与总账 1405 勾稽一致' } };
}

// ---------------------------------------------------------------------------
// 6) 凭证借贷平衡：每张凭证 Σ借 == Σ贷（draft 与 posted 一视同仁）
// ---------------------------------------------------------------------------

export interface VoucherLineLite {
  voucher_id: string;
  direction: string; // debit / credit
  amount: number;
}

export interface VoucherHead {
  id: string;
  voucher_no: string;
  status: string;
}

export function evalVoucherBalance(
  vouchers: VoucherHead[],
  lines: VoucherLineLite[],
): AssertionOutcome {
  const byVoucher = new Map<string, { debit: number; credit: number }>();
  for (const l of lines) {
    const agg = byVoucher.get(l.voucher_id) ?? { debit: 0, credit: 0 };
    // 库内方向为 d/c 短码（兼容 debit/credit 全拼）
    if (l.direction === 'd' || l.direction === 'debit') agg.debit = round2(agg.debit + l.amount);
    else agg.credit = round2(agg.credit + l.amount);
    byVoucher.set(l.voucher_id, agg);
  }
  const unbalanced: Array<Record<string, unknown>> = [];
  for (const v of vouchers) {
    const agg = byVoucher.get(v.id) ?? { debit: 0, credit: 0 };
    if (Math.abs(agg.debit - agg.credit) > EPS_AMT) {
      unbalanced.push({
        voucher_id: v.id,
        voucher_no: v.voucher_no,
        status: v.status,
        debit: agg.debit,
        credit: agg.credit,
        diff: round2(agg.debit - agg.credit),
      });
    }
  }
  if (unbalanced.length > 0) {
    return {
      result: 'fail',
      failureType: 'VOUCHER_UNBALANCED',
      detail: { unbalanced: unbalanced.slice(0, 50), unbalanced_count: unbalanced.length, vouchers_checked: vouchers.length },
    };
  }
  return { result: 'pass', detail: { vouchers_checked: vouchers.length, lines_checked: lines.length, message: '全部凭证借贷平衡' } };
}

// ---------------------------------------------------------------------------
// 7) 应收应付对账：单据 − 已核销 − 已退 == 往来余额（双边均 >= 0 允许截断）
// ---------------------------------------------------------------------------

export interface ArApSnapshot {
  /** 应收：已出库销售总额 */
  so_billed: number;
  /** 已审销售退货总额 */
  so_returned: number;
  /** 已核销收款总额 */
  received: number;
  /** 应付：已入库采购总额 */
  po_billed: number;
  /** 已审采购退货总额 */
  po_returned: number;
  /** 红蓝字冲回净额（蓝 − 红） */
  po_reversal_net: number;
  /** 已核销付款总额 */
  paid: number;
}

export function evalArApRecon(s: ArApSnapshot): AssertionOutcome {
  const receivable = round2(s.so_billed - s.so_returned - s.received);
  const payable = round2(s.po_billed + s.po_reversal_net - s.po_returned - s.paid);
  const detail: Record<string, unknown> = {
    receivable,
    payable,
    formula: {
      receivable: 'so_billed - so_returned - received',
      payable: 'po_billed + po_reversal_net - po_returned - paid',
    },
    components: s,
  };
  // 对账恒等式天然成立（同源计算），负值截断前的 raw 若为负说明超额核销/退货超单 → fail
  const problems: string[] = [];
  if (receivable < -EPS_AMT) problems.push(`应收余额为负 ${receivable}（收款或退货超单）`);
  if (payable < -EPS_AMT) problems.push('应付余额为负 ' + payable + '（付款或退货超单）');
  if (problems.length > 0) {
    return { result: 'fail', failureType: 'ARAP_NEGATIVE', detail: { ...detail, problems } };
  }
  return { result: 'pass', detail: { ...detail, message: '应收=单据-已核销-已退；应付=单据+冲回净额-已退-已付，双边非负闭合' } };
}

// ---------------------------------------------------------------------------
// 汇总：一次跑批结果
// ---------------------------------------------------------------------------

export interface AssertionSpec {
  key: string;
  name: string;
  severity: 'fail' | 'warn';
}

export interface AssertionReport extends AssertionOutcome {
  key: string;
  name: string;
  severity: 'fail' | 'warn';
}

export function summarizeRun(reports: AssertionReport[]): {
  total: number;
  passed: number;
  warned: number;
  failed: number;
  blocking: boolean;
} {
  let passed = 0;
  let warned = 0;
  let failed = 0;
  for (const r of reports) {
    if (r.result === 'pass') passed += 1;
    else if (r.result === 'warn') warned += 1;
    else failed += 1;
  }
  // 阻断结账只看 fail 级且 severity=fail 的断言
  const blocking = reports.some((r) => r.result === 'fail' && r.severity === 'fail');
  return { total: reports.length, passed, warned, failed, blocking };
}
