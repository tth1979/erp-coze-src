'use client';

import { useCallback, useEffect, useState } from 'react';
import { Banknote, CheckCircle2, Link2, RefreshCw, Trash2, Unlink, XCircle } from 'lucide-react';
import { formatMoney } from '@/components/finance/balance-list';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useAuth } from '@/components/auth/auth-provider';

interface JournalLine {
  id: string;
  date: string;
  direction: 'in' | 'out';
  amount: number;
  doc_no: string;
  method: string | null;
  ref_no: string | null;
  matched: boolean;
}
interface StatementLine {
  id: string;
  bank_account: string;
  tran_date: string;
  direction: 'in' | 'out';
  amount: number;
  summary: string | null;
  matched_status: 'unmatched' | 'matched';
  matched_ref_no: string | null;
  source: string;
}
interface Reconciliation {
  book_balance: number;
  bank_balance: number;
  book_unmatched_in: number;
  book_unmatched_out: number;
  bank_unmatched_in: number;
  bank_unmatched_out: number;
  adjusted_book: number;
  adjusted_bank: number;
  diff: number;
  balanced: boolean;
}
interface ReconView {
  account: string;
  journal: JournalLine[];
  statements: StatementLine[];
  reconciliation: Reconciliation;
}

const dirLabel = (d: 'in' | 'out') => (d === 'in' ? '收入' : '支出');

export default function BankReconPage() {
  const { can } = useAuth();
  const canWrite = can('fin.write');
  const [data, setData] = useState<ReconView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/fin/bank-recon');
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? '加载失败');
      setData((await res.json()) as ReconView);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function runAutoMatch() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/fin/bank-statements/auto-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? '自动对账失败');
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function unmatch(id: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/fin/bank-statements/${id}/unmatch`, { method: 'POST' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? '取消失败');
      setData((await res.json()) as ReconView);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function delStatement(id: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/fin/bank-statements/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? '删除失败');
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const rec = data?.reconciliation;

  if (loading) {
    return (
      <div className="space-y-4 p-1">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-5 p-1">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">银行对账</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            账户：{data?.account ?? '基本户'} · 日记账由收付款/报销付款自动归集
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={busy}>
            <RefreshCw className="mr-1 h-4 w-4" />刷新
          </Button>
          {canWrite && (
            <Button size="sm" onClick={() => void runAutoMatch()} disabled={busy}>
              <Link2 className="mr-1 h-4 w-4" />自动对账
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {rec && (
        <div className="rounded-lg border bg-card p-4">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <h2 className="text-sm font-semibold">未达账项调节表</h2>
            {rec.balanced ? (
              <Badge variant="secondary" className="gap-1">
                <CheckCircle2 className="h-3.5 w-3.5" />已平衡
              </Badge>
            ) : (
              <Badge variant="destructive" className="gap-1">
                <XCircle className="h-3.5 w-3.5" />差额 {formatMoney(rec.diff)}
              </Badge>
            )}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5 text-sm">
              <div className="font-medium">账面（日记账）</div>
              <Row label="账面余额" value={rec.book_balance} />
              <Row label="+ 银行已记未记（收入）" value={rec.bank_unmatched_in} />
              <Row label="− 银行已记未记（支出）" value={rec.bank_unmatched_out} />
              <Row label="账面调节后余额" value={rec.adjusted_book} strong />
            </div>
            <div className="space-y-1.5 text-sm">
              <div className="font-medium">银行（对账单）</div>
              <Row label="对账单余额" value={rec.bank_balance} />
              <Row label="+ 企业已记未记（收入）" value={rec.book_unmatched_in} />
              <Row label="− 企业已记未记（支出）" value={rec.book_unmatched_out} />
              <Row label="银行调节后余额" value={rec.adjusted_bank} strong />
            </div>
          </div>
        </div>
      )}

      <StatementSection
        data={data}
        canWrite={canWrite}
        busy={busy}
        onImported={load}
        onDelete={delStatement}
        onUnmatch={unmatch}
        onError={setError}
      />

      <div className="rounded-lg border bg-card">
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <Banknote className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">银行日记账（系统归集）</h2>
          <span className="text-xs text-muted-foreground">共 {data?.journal.length ?? 0} 笔</span>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>日期</TableHead>
              <TableHead>单号</TableHead>
              <TableHead>方向</TableHead>
              <TableHead className="text-right">金额</TableHead>
              <TableHead>对账状态</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(data?.journal ?? []).length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                  暂无日记账流水
                </TableCell>
              </TableRow>
            ) : (
              (data?.journal ?? []).map((j) => (
                <TableRow key={j.id}>
                  <TableCell className="whitespace-nowrap">{j.date}</TableCell>
                  <TableCell className="font-mono text-xs">{j.doc_no}</TableCell>
                  <TableCell>
                    <Badge variant={j.direction === 'in' ? 'secondary' : 'outline'}>{dirLabel(j.direction)}</Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(j.amount)}</TableCell>
                  <TableCell>
                    {j.matched ? (
                      <Badge variant="secondary">已匹配</Badge>
                    ) : (
                      <Badge variant="outline">未达</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className={`flex items-center justify-between ${strong ? 'border-t pt-1 font-semibold' : ''}`}>
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{formatMoney(value)}</span>
    </div>
  );
}

interface StatementSectionProps {
  data: ReconView | null;
  canWrite: boolean;
  busy: boolean;
  onImported: () => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
  onUnmatch: (id: string) => void | Promise<void>;
  onError: (msg: string) => void;
}

function StatementSection({ data, canWrite, busy, onImported, onDelete, onUnmatch, onError }: StatementSectionProps) {
  const [form, setForm] = useState({ tran_date: '', direction: 'out', amount: '', summary: '' });
  const [submitting, setSubmitting] = useState(false);

  async function addOne() {
    if (!form.tran_date || !form.amount) {
      onError('请填写交易日期与金额');
      return;
    }
    setSubmitting(true);
    onError('');
    try {
      const res = await fetch('/api/fin/bank-statements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tran_date: form.tran_date,
          direction: form.direction,
          amount: Number(form.amount),
          summary: form.summary || null,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? '录入失败');
      setForm({ tran_date: '', direction: 'out', amount: '', summary: '' });
      await onImported();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  const statements = data?.statements ?? [];

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <h2 className="text-sm font-semibold">银行对账单</h2>
        <span className="text-xs text-muted-foreground">共 {statements.length} 笔</span>
      </div>

      {canWrite && (
        <div className="flex flex-wrap items-end gap-2 border-b px-4 py-3">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">交易日期</span>
            <input
              type="date"
              value={form.tran_date}
              onChange={(e) => setForm((f) => ({ ...f, tran_date: e.target.value }))}
              className="h-9 rounded-md border bg-background px-2 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">方向</span>
            <select
              value={form.direction}
              onChange={(e) => setForm((f) => ({ ...f, direction: e.target.value }))}
              className="h-9 rounded-md border bg-background px-2 text-sm"
            >
              <option value="out">支出</option>
              <option value="in">收入</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">金额</span>
            <input
              type="number"
              value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
              placeholder="0.00"
              className="h-9 w-28 rounded-md border bg-background px-2 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">摘要</span>
            <input
              value={form.summary}
              onChange={(e) => setForm((f) => ({ ...f, summary: e.target.value }))}
              placeholder="可选"
              className="h-9 w-48 rounded-md border bg-background px-2 text-sm"
            />
          </div>
          <Button size="sm" onClick={() => void addOne()} disabled={submitting || busy}>
            录入
          </Button>
        </div>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>交易日期</TableHead>
            <TableHead>方向</TableHead>
            <TableHead className="text-right">金额</TableHead>
            <TableHead>摘要</TableHead>
            <TableHead>对账状态</TableHead>
            <TableHead className="text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {statements.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                暂无对账单，请录入或导入
              </TableCell>
            </TableRow>
          ) : (
            statements.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="whitespace-nowrap">{s.tran_date}</TableCell>
                <TableCell>
                  <Badge variant={s.direction === 'in' ? 'secondary' : 'outline'}>{dirLabel(s.direction)}</Badge>
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(s.amount)}</TableCell>
                <TableCell className="max-w-[220px] truncate text-sm text-muted-foreground">
                  {s.summary ?? '—'}
                </TableCell>
                <TableCell>
                  {s.matched_status === 'matched' ? (
                    <Badge variant="secondary" className="gap-1">
                      <CheckCircle2 className="h-3.5 w-3.5" />已匹配 {s.matched_ref_no ? `· ${s.matched_ref_no}` : ''}
                    </Badge>
                  ) : (
                    <Badge variant="outline">未达</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {canWrite && (
                    <div className="flex justify-end gap-1">
                      {s.matched_status === 'matched' && (
                        <Button variant="ghost" size="sm" onClick={() => void onUnmatch(s.id)} disabled={busy}>
                          <Unlink className="mr-1 h-3.5 w-3.5" />取消
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        onClick={() => void onDelete(s.id)}
                        disabled={busy}
                      >
                        <Trash2 className="mr-1 h-3.5 w-3.5" />删除
                      </Button>
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
