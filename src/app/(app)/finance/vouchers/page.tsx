'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Eye, RotateCcw, Search } from 'lucide-react';
import { useAuth } from '@/components/auth/auth-provider';
import { formatMoney } from '@/components/finance/balance-list';
import { PaginationControls } from '@/components/master-data/pagination-controls';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
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

const EVENT_LABELS: Record<string, string> = {
  sales_shipment: '销售出库',
  purchase_receipt: '采购入库',
  receipt_settle: '收款核销',
  payment_settle: '付款核销',
  receipt_reverse: '暂估冲回',
  void: '红字冲销',
};

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

export default function VouchersPage() {
  const { can } = useAuth();
  const canWrite = can('fin.write');
  const [searchInput, setSearchInput] = useState('');
  const [status, setStatus] = useState('');
  const [eventType, setEventType] = useState('');
  const list = usePagedList<Voucher>('/api/fin/vouchers', 10, { status, event_type: eventType });
  const [detail, setDetail] = useState<Voucher | null>(null);
  const [voidTarget, setVoidTarget] = useState<Voucher | null>(null);
  const [acting, setActing] = useState(false);

  async function openDetail(v: Voucher) {
    setDetail(v);
    try {
      const full = await apiFetch<Voucher>(`/api/fin/vouchers/${v.id}`);
      setDetail(full);
    } catch {
      // 列表已含分录，无详情时沿用
    }
  }

  async function doVoid() {
    if (!voidTarget) return;
    setActing(true);
    try {
      await apiFetch(`/api/fin/vouchers/${voidTarget.id}/void`, { method: 'POST', body: JSON.stringify({ reason: '红字冲销' }) });
      toast.success('已红字冲销', { description: `凭证 ${voidTarget.voucher_no} 已作废，生成红冲凭证` });
      setVoidTarget(null);
      list.reload();
    } catch (e) {
      toast.error('冲销失败', { description: (e as Error).message });
    } finally {
      setActing(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-stone-900">记账凭证</h1>
        <p className="text-xs text-stone-500 sm:text-sm">
          业务事件（销售出库/采购入库/收款核销/付款核销/暂估冲回）自动生成，借贷平衡、按事件幂等防重；红冲仅限已过账凭证
        </p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          className="sm:max-w-xs"
          placeholder="搜索凭证号 / 业务单号 / 摘要"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              list.setKeyword(searchInput);
            }
          }}
        />
        <Button variant="outline" onClick={() => list.setKeyword(searchInput)}>
          <Search className="size-4" />
        </Button>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-36">
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
              .filter(([k]) => k !== 'void')
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
              <TableHead className="w-40 text-right">操作</TableHead>
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
                  暂无凭证数据。业务单据终审/核销后自动生成记账凭证。
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
                      {canWrite && v.status === 'posted' && (
                        <Button variant="ghost" size="icon" className="text-rose-600" onClick={() => setVoidTarget(v)}>
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
                        <span className="font-mono text-xs text-stone-500">{l.account_code}</span>{' '}
                        {l.account_name}
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

      {/* 红冲确认 */}
      <Dialog open={!!voidTarget} onOpenChange={(o) => !o && setVoidTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>红字冲销凭证</DialogTitle>
            <DialogDescription>
              将作废凭证「{voidTarget?.voucher_no}」并生成一张反向红字冲销凭证，借贷平衡。此操作不可撤销。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVoidTarget(null)}>
              取消
            </Button>
            <Button variant="destructive" disabled={acting} onClick={doVoid}>
              <RotateCcw className="size-4" />
              确认红字冲销
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}