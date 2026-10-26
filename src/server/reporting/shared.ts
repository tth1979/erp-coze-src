/**
 * 经营统计报表 - 共享工具
 *
 * 数据来源：只读聚合现有 po_/so_/inv_/fin_ 落库数据，不使用实时时序。
 * SDK-only 约束：内存聚合（拉取单据后用 JS 分桶），不写 SQL 聚合、不建视图。
 */

/** 报表分组维度 */
export type ReportGroupBy = 'month' | 'supplier' | 'customer' | 'product' | 'warehouse';

/** 日期范围（YYYY-MM-DD，可部分省略） */
export interface DateRange {
  from: string;
  to: string;
}

/** 解析日期范围参数；返回 null 表示不限范围 */
export function parseRange(searchParams: URLSearchParams): DateRange {
  return {
    from: searchParams.get('from') ?? '',
    to: searchParams.get('to') ?? '',
  };
}

/** 判断 YYYY-MM-DD 是否落在 [from, to] 范围内（空端不限） */
export function inRange(date: string, range: DateRange): boolean {
  if (!date) return true;
  if (range.from && date < range.from) return false;
  if (range.to && date > range.to) return false;
  return true;
}

/** 金额/数量统一转 number，null/非法 → 0 */
export function toNum(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** 保留两位小数 */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** 月份键（YYYY-MM） */
export function monthKey(date: string): string {
  return (date || '').slice(0, 7);
}

/** 生成近 N 个月的月份键序列（含当月，从早到晚） */
export function recentMonthKeys(months: number): string[] {
  const now = new Date();
  const keys: string[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return keys;
}

/** 今日键与本月键 */
export function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function currentMonthKey(): string {
  return todayKey().slice(0, 7);
}