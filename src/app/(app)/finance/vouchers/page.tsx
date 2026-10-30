'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ArrowUp, Calendar, Eye, Plus, RotateCcw, Search, Trash2 } from 'lucide-react';
import { useAuth } from '@/components/auth/auth-provider';
import { formatMoney } from '@/components/finance/balance-list';
import { PaginationControls } from '@/components/master-data/pagination-controls';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { usePagedList } from '@/lib/use-paged-list';
import { apiFetch } from '@/lib/api-client';

interface VoucherLine {
  line_no: number;
  direction: string;
  account_code: string;
  account_name: string;
  amount: string;
  summary?: string | null;
}
interface Voucher {
  id: string;
  voucher_no: string;
  voucher_date: string;
  event_type: string;
  event_id: string;
  ref_no: string | null;
  ref_summary: string | null;
  template_code: string;
  total_debit: string;
  total_credit: string;
  status: string;
  source: string;
  void_of_no: string | null;
  created_by: string | null;
  created_at: string;
  posted_at: string | null;
  void_by: string | null;
  void_at: string | null;
  void_remark: string | null;
  lines: VoucherLine[];
}

interface SubjectOption {
  id: string;
  subject_code: string;
  subject_name: string;
  category: number;
  is_leaf: boolean;
  status: string;
}

const EVENT_LABELS: Record<string, string> = {
  sales_shipment: '销售出库',
  purchase_receipt: '采购入库',
  receipt_settle: '收款核销',
  payment_settle: '付款核销',
  receipt_reverse: '暂估冲回',
  sales_cof_shipment: '销售成本结转',
  manufacture_finish: '加工完工结转',
  manual: '手工记账',
  void: '红字冲销',
};

const CATEGORY_LABELS: Record<number, string> = { 1: '资产', 2: '负债', 3: '共同', 4: '权益', 5: '成本', 6: '损益' };

function eventLabel(t: string): string {
  return EVENT_LABELS[t] ?? t;
}

function statusBadge(status: string) {
  if (status === 'posted') {
    return (
      <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
        已过账
      </Badge>
    );
  }
  if (status === 'draft') {
    return (
      <Badge variant="outline" className="border-sky-200 bg-sky-50 text-sky-700">
        未过账
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="border-rose-200 bg-rose-50 text-rose-600">
      已红冲作废
    </Badge>
  );
}

interface ManualLine {
  line_no: number;
  direction: 'd' | 'c';
  account_code: string;
  amount: string;
  summary: string;
}

export default function VouchersPage() {
  const { can } = useAuth();
  const canWrite = can('fin.write');
  const [searchInput, setSearchInput] = useState('');
  const [status, setStatus] = useState('');
  const [eventType, setEventType] = useState('');
  const [period, setPeriod] = useState('');
  const [accountCode, setAccountCode] = useState('__all');
  const list = usePagedList<Voucher>('/api/fin/vouchers', 10, {
    status,
    event_type: eventType,
    period,
    account_code: accountCode === '__all' ? '' : accountCode,
  });
  const [detail, setDetail] = useState<Voucher | null>(null);
  const [voidTarget, setVoidTarget] = useState<Voucher | null>(null);
  const [postTarget, setPostTarget] = useState<Voucher | null>(null);
  const [delTarget, setDelTarget] = useState<Voucher | null>(null);
  const [acting, setActing] = useState(false);

  const [manualOpen, setManualOpen] = useState(false);
  const [manualDate, setManualDate] = useState('');
  const [manualSummary, setManualSummary] = useState('');
  const [manualLines, setManualLines] = useState<ManualLine[]>([
    { line_no: 1, direction: 'd', account_code: '', amount: '', summary: '' },
    { line_no: 2, direction: 'c', account_code: '', amount: '', summary: '' },
  ]);
  const [subjects, setSubjects] = useState<SubjectOption[]>([]);

  useEffect(() => {
    if (manualOpen && subjects.length === 0) {
      apiFetch<{ items: SubjectOption[] }>('/api/fin/subjects?page=1&pageSize=100')
        .then((data) => setSubjects(data.items))
        .catch(() => toast.error('加载科目失败'));
    }
  }, [manualOpen, subjects.length]);

  const leafSubjects = subjects.filter((s) => s.is_leaf && s.status === 'active');

  async function openDetail(v: Voucher) {
    setDetail(v);
    try {
      const full = await apiFetch<Voucher>(`/api/fin/vouchers/${v.id}`);
      setDetail(full);
    } catch {
      // 列表已含分录
    }
  }

  async function doVoid() {
    if (!voidTarget) return;
    setActing(true);
    try {
      await apiFetch(`/api/fin/vouchers/${voidTarget.id}/void`, { method: 'POST', body: JSON.stringify({ reason: '红字冲销' }) });
      toast.success('已红字冲销');
      setVoidTarget(null);
      list.reload();
    } catch (e) {
      toast.error('冲销失败', { description: (e as Error).message });
    } finally {
      setActing(false);
    }
  }

  async function doPost() {
    if (!postTarget) return;
    setActing(true);
    try {
      await apiFetch(`/api/fin/vouchers/${postTarget.id}/post`, { method: 'POST' });
      toast.success('已过账');
      setPostTarget(null);
      list.reload();
    } catch (e) {
      toast.error('过账失败', { description: (e as Error).message });
    } finally {
      setActing(false);
    }
  }

  async function doDelete() {
    if (!delTarget) return;
    setActing(true);
    try {
      await apiFetch(`/api/fin/vouchers/${delTarget.id}`, { method: 'DELETE' });
      toast.success('已删除草稿凭证');
      setDelTarget(null);
      list.reload();
    } catch (e) {
      toast.error('删除失败', { description: (e as Error).message });
    } finally {
      setActing(false);
    }
  }

  function updateManualLine(no: number, patch: Partial<ManualLine>) {
    setManualLines((ls) => ls.map((l) => (l.line_no === no ? { ...l, ...patch } : l)));
  }

  function addManualLine() {
    setManualLines((ls) => [...ls, { line_no: ls.length + 1, direction: ls.length % 2 === 0 ? 'c' : 'd', account_code: '', amount: '', summary: '' }]);
  }

  function removeManualLine(no: number) {
    setManualLines((ls) => ls.filter((l) => l.line_no !== no));
  }

  async function submitManual() {
    const lines = manualLines
      .filter((l) => l.account_code && Number(l.amount) > 0)
      .map((l) => ({ direction: l.direction, account_code: l.account_code, summary: l.summary || undefined, amount: Number(l.amount) }));
    if (lines.length < 2) {
      toast.error('至少需要两条分录（一借一贷）');
      return;
    }
    setActing(true);
    try {
      await apiFetch('/api/fin/vouchers', {
        method: 'POST',
        body: JSON.stringify({ voucher_date: manualDate, ref_summary: manualSummary || undefined, lines }),
      });
      toast.success('已创建草稿凭证');
      setManualOpen(false);
      setManualDate('');
      setManualSummary('');
      setManualLines([
        { line_no: 1, direction: 'd', account_code: '', amount: '', summary: '' },
        { line_no: 2, direction: 'c', account_code: '', amount: '', summary: '' },
      ]);
      list.reload();
    } catch (e) {
      toast.error('创建失败', { description: (e as Error).message });
    } finally {
      setActing(false);
    }
  }

  const manualSumD = manualLines.filter((l) => l.direction === 'd').reduce((a, l) => a + (Number(l.amount) || 0), 0);
  const manualSumC = manualLines.filter((l) => l.direction === 'c').reduce((a, l) => a + (Number(l.amount) || 0), 0);
  const balanced = Math.abs(manualSumD - manualSumC) < 0.01 && manualSumD > 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold text-stone-900">记账凭证</h1>
          <p className="text-xs text-stone-500 sm:text-sm">
            业务事件自动生成；支持科目期间/科目筛选、手工记账草稿、过账与红字冲销
          </p>
        </div>
        {canWrite && (
          <Button onClick={() => setManualOpen(true)}>
            <Plus className="size-4" />
            手工记账
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="sm:max-w-xs"
          placeholder="搜索凭证号 / 业务单号 / 摘要"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') list.setKeyword(searchInput);
          }}
        />
        <Button variant="outline" onClick={() => list.setKeyword(searchInput)}>
          <Search className="size-4" />
        </Button>
        <div className="flex items-center gap-1 rounded-md border border-stone-200 px-2">
          <Calendar className="size-4 text-stone-400" />
          <input
            type="month"
            value={period}
            onChange={(e) => {
              setPeriod(e.target.value);
              list.setPage(1);
            }}
            className="h-9 bg-transparent text-sm outline-none"
          />
        </div>
        <Input
          className="sm:max-w-[130px]"
          placeholder="科目编码"
          value={accountCode === '__all' ? '' : accountCode}
          onChange={(e) => {
            setAccountCode(e.target.value || '__all');
            list.setPage(1);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') list.setPage(1);
          }}
        />
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-32">
            <SelectValue placeholder="全部状态" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">全部状态</SelectItem>
            <SelectItem value="posted">已过账</SelectItem>
            <SelectItem value="void">已红冲</SelectItem>
            <SelectItem value="draft">未过账</SelectItem>
          </SelectContent>
        </Select>
        <Select value={eventType} onValueChange={setEventType}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="全部事件" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">全部事件</SelectItem>
            {Object.entries(EVENT_LABELS)
              .filter(([k]) => k !== 'void' && k !== 'sales_cof_shipment' && k !== 'manufacture_finish')
              .map(([k, v]) => (
                <SelectItem key={k} value={k}>
                  {v}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-lg border border-stone-200 bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>凭证号</TableHead>
              <TableHead>日期</TableHead>
              <TableHead>事件</TableHead>
              <TableHead>摘要</TableHead>
              <TableHead className="text-right">借方合计</TableHead>
              <TableHead className="text-right">贷方合计</TableHead>
              <TableHead>状态</TableHead>
              <TableHead className="w-44 text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={8}>
                    <Skeleton className="h-6 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : list.items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-stone-400">
                  暂无凭证数据。业务单据终审/核销后自动生成记账凭证，或手工记账。
                </TableCell>
              </TableRow>
            ) : (
              list.items.map((v) => (
                <TableRow key={v.id}>
                  <TableCell className="font-mono text-xs">{v.voucher_no}</TableCell>
                  <TableCell className="text-sm">{v.voucher_date}</TableCell>
                  <TableCell className="text-sm">{eventLabel(v.event_type)}</TableCell>
                  <TableCell className="max-w-[180px] truncate text-sm text-stone-600" title={v.ref_summary ?? ''}>
                    {v.ref_summary ?? v.ref_no ?? '—'}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">{formatMoney(Number(v.total_debit))}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{formatMoney(Number(v.total_credit))}</TableCell>
                  <TableCell>{statusBadge(v.status)}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" onClick={() => openDetail(v)}>
                        <Eye className="size-4" />
                      </Button>
                      {canWrite && v.status === 'draft' && (
                        <>
                          <Button variant="ghost" size="icon" className="text-emerald-600" onClick={() => setPostTarget(v)} title="过账">
                            <ArrowUp className="size-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="text-sky-600" onClick={() => setVoidTarget(v)} title="作废">
                            <RotateCcw className="size-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="text-rose-600" onClick={() => setDelTarget(v)} title="删除草稿">
                            <Trash2 className="size-4" />
                          </Button>
                        </>
                      )}
                      {canWrite && v.status === 'posted' && (
                        <Button variant="ghost" size="icon" className="text-rose-600" onClick={() => setVoidTarget(v)} title="红字冲销">
                          <RotateCcw className="size-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        <PaginationControls page={list.page} pageSize={list.pageSize} total={list.total} onPageChange={list.setPage} />
      </div>

      {/* 凭证详情 */}
      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>凭证 {detail?.voucher_no}</DialogTitle>
            <DialogDescription>
              {detail && (
                <span>
                  {detail.voucher_date} · {eventLabel(detail.event_type)} · {detail.ref_summary ?? detail.ref_no ?? '—'}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          {detail && (
            <div className="max-h-[50vh] overflow-auto rounded-md border border-stone-200">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-14">方向</TableHead>
                    <TableHead>科目</TableHead>
                    <TableHead className="text-right">金额</TableHead>
                    <TableHead>摘要</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.lines.map((l) => (
                    <TableRow key={l.line_no}>
                      <TableCell>
                        <Badge variant="outline" className={l.direction === 'd' ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-sky-200 bg-sky-50 text-sky-700'}>
                          {l.direction === 'd' ? '借' : '贷'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        <span className="font-mono text-xs text-stone-500">{l.account_code}</span> {l.account_name}
                      </TableCell>
                      <TableCell className={`text-right font-mono text-sm ${Number(l.amount) < 0 ? 'text-rose-600' : ''}`}>
                        {formatMoney(Number(l.amount))}
                      </TableCell>
                      <TableCell className="text-xs text-stone-500">{l.summary ?? ''}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell colSpan={2} className="font-medium">
                      合计
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      借 {formatMoney(Number(detail.total_debit))} / 贷 {formatMoney(Number(detail.total_credit))}
                    </TableCell>
                    <TableCell />
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* 手工记账 */}
      <Dialog open={manualOpen} onOpenChange={(o) => !o && setManualOpen(false)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>手工记账（草稿）</DialogTitle>
            <DialogDescription>录入一借一贷或更多分录，借贷合计须相等；先建草稿，过账后生效。仅末级启用科目可用。</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>凭证日期</Label>
                <Input type="date" value={manualDate} onChange={(e) => setManualDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>摘要</Label>
                <Input value={manualSummary} onChange={(e) => setManualSummary(e.target.value)} placeholder="业务摘要" />
              </div>
            </div>
            {manualLines.map((l) => (
              <div key={l.line_no} className="flex items-center gap-2">
                <Select value={l.direction} onValueChange={(v) => updateManualLine(l.line_no, { direction: v as 'd' | 'c' })}>
                  <SelectTrigger className="w-20">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="d">借</SelectItem>
                    <SelectItem value="c">贷</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={l.account_code} onValueChange={(v) => updateManualLine(l.line_no, { account_code: v })}>
                  <SelectTrigger className="w-44">
                    <SelectValue placeholder="科目" />
                  </SelectTrigger>
                  <SelectContent>
                    {leafSubjects.map((s) => (
                      <SelectItem key={s.id} value={s.subject_code}>
                        {s.subject_code} {s.subject_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  className="w-32"
                  placeholder="金额"
                  value={l.amount}
                  onChange={(e) => updateManualLine(l.line_no, { amount: e.target.value })}
                />
                <Input className="flex-1" placeholder="行摘要(可选)" value={l.summary} onChange={(e) => updateManualLine(l.line_no, { summary: e.target.value })} />
                <Button variant="ghost" size="icon" className="text-rose-500" onClick={() => removeManualLine(l.line_no)} disabled={manualLines.length <= 2}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={addManualLine}>
              <Plus className="size-4" /> 添加分录
            </Button>
            <div className={`rounded-md px-3 py-2 text-sm font-medium ${balanced ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600'}`}>
              借 {formatMoney(manualSumD)} / 贷 {formatMoney(manualSumC)} {balanced ? '· 平衡' : manualSumD > 0 ? '· 差额 ' + formatMoney(Math.abs(manualSumD - manualSumC)) : '· 待录入金额'}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setManualOpen(false)}>
              取消
            </Button>
            <Button disabled={acting || !manualDate || !balanced} onClick={submitManual}>
              保存草稿
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 过账确认 */}
      <Dialog open={!!postTarget} onOpenChange={(o) => !o && setPostTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>过账凭证</DialogTitle>
            <DialogDescription>凭证「{postTarget?.voucher_no}」将过账锁定，参与科目余额/试算平衡；如需更正需红字冲销。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPostTarget(null)}>
              取消
            </Button>
            <Button disabled={acting} onClick={doPost}>
              <ArrowUp className="size-4" />
              确认过账
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 红冲/作废确认 */}
      <Dialog open={!!voidTarget} onOpenChange={(o) => !o && setVoidTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{voidTarget?.status === 'draft' ? '作废草稿凭证' : '红字冲销凭证'}</DialogTitle>
            <DialogDescription>
              {voidTarget?.status === 'draft'
                ? `作废草稿「${voidTarget?.voucher_no}」，不影响余额。`
                : `将作废已过账凭证「${voidTarget?.voucher_no}」并生成一张反向红字冲销凭证。此操作不可撤销。`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVoidTarget(null)}>
              取消
            </Button>
            <Button variant="destructive" disabled={acting} onClick={doVoid}>
              <RotateCcw className="size-4" />
              确认
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除草稿确认 */}
      <Dialog open={!!delTarget} onOpenChange={(o) => !o && setDelTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除草稿凭证</DialogTitle>
            <DialogDescription>将直接删除未过账草稿「{delTarget?.voucher_no}」，不可恢复。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDelTarget(null)}>
              取消
            </Button>
            <Button variant="destructive" disabled={acting} onClick={doDelete}>
              <Trash2 className="size-4" />
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}