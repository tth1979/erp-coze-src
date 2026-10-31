'use client';

import { useCallback, useEffect, useState } from 'react';
import { CalendarCheck2, Lock, RefreshCw, RotateCcw, FileText, ScrollText } from 'lucide-react';
import { formatMoney } from '@/components/finance/balance-list';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useAuth } from '@/components/auth/auth-provider';

interface PeriodItem {
  period: string;
  status: string;
  locked: boolean;
  year_end: boolean;
  profit_close_voucher_no: string | null;
  voucher_count: number;
  total_debit: number;
  total_credit: number;
  balanced: boolean;
  closed_by: string | null;
  closed_at: string | null;
  reversed_reason: string | null;
}
interface LogItem {
  id: string;
  period: string;
  action: string;
  actor: string | null;
  reason: string | null;
  ref_voucher_no: string | null;
  happened_at: string;
}
interface YearCloseResult {
  year: string;
  months_closed: number;
  retained: string | null;
}

function currentPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function currentYear(): string {
  return String(new Date().getFullYear());
}

export default function PeriodClosePage() {
  const auth = useAuth();
  const canWrite = auth.can('fin.write');
  const [items, setItems] = useState<PeriodItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');

  // 反结账弹窗
  const [reopenTarget, setReopenTarget] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  // 年结弹窗
  const [yearDialog, setYearDialog] = useState(false);
  const [year, setYear] = useState(currentYear());
  const [yearBusy, setYearBusy] = useState(false);
  // 日志抽屉
  const [logPeriod, setLogPeriod] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  // 行内 busy
  const [busy, setBusy] = useState<string>('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/fin/periods');
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { message?: string }).message ?? '加载失败');
      }
      setItems((await res.json()) as PeriodItem[]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function runAction(url: string, method: 'POST' | 'PUT' = 'POST', body?: unknown) {
    setActionError('');
    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) throw new Error(data.message ?? '操作失败');
      return data;
    } catch (e) {
      setActionError((e as Error).message);
      throw e;
    }
  }

  async function doProfitClose(period: string) {
    setBusy(`pc-${period}`);
    try {
      await runAction(`/api/fin/periods/${period}/profit-close`);
      await load();
    } finally {
      setBusy('');
    }
  }

  async function doClose(period: string) {
    setBusy(`cl-${period}`);
    try {
      await runAction(`/api/fin/periods/${period}/close`);
      await load();
    } finally {
      setBusy('');
    }
  }

  async function doReopen() {
    if (!reopenTarget) return;
    setBusy(`re-${reopenTarget}`);
    try {
      await runAction(`/api/fin/periods/${reopenTarget}/reopen`, 'POST', { reason });
      setReopenTarget(null);
      setReason('');
      await load();
    } finally {
      setBusy('');
    }
  }

  async function doYearClose() {
    setYearBusy(true);
    try {
      const data = (await runAction(`/api/fin/periods/${year}-12/year-close`)) as YearCloseResult;
      setActionError('');
      alert(`年结完成：${data.year}，共关闭 ${data.months_closed} 个月，结转留存凭证 ${data.retained ?? '无'}`);
      setYearDialog(false);
      await load();
    } catch {
      /* actionError 已设置 */
    } finally {
      setYearBusy(false);
    }
  }

  async function openLogs(period: string) {
    setLogPeriod(period);
    setLogs([]);
    setLogsLoading(true);
    try {
      const res = await fetch(`/api/fin/periods/${period}/logs`);
      if (res.ok) setLogs((await res.json()) as LogItem[]);
    } finally {
      setLogsLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold text-stone-900">期末结账与年结</h1>
          <p className="text-xs text-stone-500 sm:text-sm">月结清单：结转损益 → 锁定期间 → 反结账留痕（不可删除）→ 年末生成次年期初</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={load}>
            <RefreshCw className="size-4" />
            刷新
          </Button>
          {canWrite && (
            <Button onClick={() => setYearDialog(true)}>
              <CalendarCheck2 className="size-4" />
              年结
            </Button>
          )}
        </div>
      </div>

      {(error || actionError) && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-600">
          {error || actionError}
        </div>
      )}

      <div className="rounded-lg border border-stone-200 bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>期间</TableHead>
              <TableHead>状态</TableHead>
              <TableHead className="text-right">凭证数</TableHead>
              <TableHead className="text-right">借合计</TableHead>
              <TableHead className="text-right">贷合计</TableHead>
              <TableHead>试算平衡</TableHead>
              <TableHead>结转损益</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={8}><Skeleton className="h-6 w-full" /></TableCell>
                </TableRow>
              ))
            ) : items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-stone-400">
                  暂无会计期间数据。结账首个期间时将自动创建。
                </TableCell>
              </TableRow>
            ) : (
              items.map((it) => {
                const statusLabel =
                  it.status === 'annual_closed' ? '年结封闭' : it.status === 'closed' ? '已结账' : '未结账';
                const statusColor =
                  it.status === 'annual_closed' ? 'default' : it.status === 'closed' ? 'secondary' : 'outline';
                return (
                  <TableRow key={it.period}>
                    <TableCell className="font-mono text-sm">{it.period}</TableCell>
                    <TableCell>
                      <Badge variant={statusColor as 'default'} className="capitalize">
                        {statusLabel}
                        {it.year_end && ' · 年结'}
                      </Badge>
                      {it.reversed_reason && (
                        <div className="mt-1 max-w-[180px] truncate text-[11px] text-amber-600" title={it.reversed_reason}>
                          反结账：{it.reversed_reason}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">{it.voucher_count}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{formatMoney(it.total_debit)}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{formatMoney(it.total_credit)}</TableCell>
                    <TableCell>
                      <Badge variant={it.balanced ? 'default' : 'destructive'}>{it.balanced ? '平衡' : '不平'}</Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{it.profit_close_voucher_no ?? '—'}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {canWrite && it.status !== 'annual_closed' && (
                          <>
                            {it.status === 'open' ? (
                              <>
                                <Button size="sm" variant="outline" disabled={!!busy} onClick={() => doProfitClose(it.period)}>
                                  <FileText className="size-3.5" /> 转损益
                                </Button>
                                <Button size="sm" disabled={!!busy} onClick={() => doClose(it.period)}>
                                  <Lock className="size-3.5" /> 结账
                                </Button>
                              </>
                            ) : (
                              <Button size="sm" variant="outline" disabled={!!busy} onClick={() => { setReopenTarget(it.period); setReason(''); }}>
                                <RotateCcw className="size-3.5" /> 反结账
                              </Button>
                            )}
                          </>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => openLogs(it.period)}>
                          <ScrollText className="size-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* 反结账弹窗 */}
      <AlertDialog open={!!reopenTarget} onOpenChange={(o) => !o && setReopenTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>反结账 {reopenTarget ?? ''}</AlertDialogTitle>
            <AlertDialogDescription>
              将已结账期间回退为未结账，允许再次修改与过账。此操作将<b>留痕记录</b>（谁/何时/原因），日志不可删除。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="请输入反结账原因（必填）"
            className="min-h-[80px] w-full rounded-md border border-stone-200 px-3 py-2 text-sm outline-none focus:border-stone-400"
          />
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction disabled={!reason.trim()} onClick={() => void doReopen()}>
              确认反结账
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 年结弹窗 */}
      <Dialog open={yearDialog} onOpenChange={setYearDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>年度结账（年结）</DialogTitle>
            <DialogDescription>
              将关闭该年度全部 12 个月并结转损益，本年利润转入未分配利润，资产/负债/权益科目期末结转至次年期初。
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <span className="text-sm text-stone-600">年份</span>
            <input
              type="number"
              value={year}
              onChange={(e) => setYear(e.target.value)}
              className="h-9 flex-1 rounded-md border border-stone-200 px-2 text-sm outline-none focus:border-stone-400"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={yearBusy} onClick={() => setYearDialog(false)}>
              取消
            </Button>
            <Button disabled={yearBusy} onClick={() => void doYearClose()}>
              {yearBusy ? '年结中…' : '确认年结'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 日志抽屉 */}
      <Dialog open={!!logPeriod} onOpenChange={(o) => !o && setLogPeriod(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>期间日志 · {logPeriod}</DialogTitle>
            <DialogDescription>结账/结转/反结账/年结操作留痕（仅追加、不可删除）</DialogDescription>
          </DialogHeader>
          {logsLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : logs.length === 0 ? (
            <div className="py-6 text-center text-sm text-stone-400">无日志</div>
          ) : (
            <div className="space-y-2">
              {logs.map((l) => (
                <div key={l.id} className="rounded-md border border-stone-100 bg-stone-50 px-3 py-2 text-xs">
                  <div className="flex items-center justify-between">
                    <Badge variant="outline" className="border-stone-200 capitalize">{l.action}</Badge>
                    <span className="font-mono text-stone-400">#{l.id}</span>
                  </div>
                  <div className="mt-1 text-stone-700">
                    {new Date(l.happened_at).toLocaleString()} · 操作人 {l.actor ?? '系统'}
                    {l.ref_voucher_no && <span className="ml-2 font-mono text-stone-500">凭证 {l.ref_voucher_no}</span>}
                  </div>
                  {l.reason && <div className="mt-0.5 text-amber-600">原因：{l.reason}</div>}
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}