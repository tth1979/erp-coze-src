'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { CheckCheck, FileText, Plus, Search, Send, Trash2, Ban } from 'lucide-react';
import { useAuth } from '@/components/auth/auth-provider';
import { formatMoney } from '@/components/finance/balance-list';
import { InvoiceFormDialog } from '@/components/tax/invoice-form-dialog';
import { PaginationControls } from '@/components/master-data/pagination-controls';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
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
import { apiFetch } from '@/lib/api-client';
import { usePagedList } from '@/lib/use-paged-list';

interface InvoiceRow {
  id: string;
  invoice_no: string;
  invoice_type: string;
  direction: string;
  invoice_date: string;
  period: string;
  amount_ex_tax: number;
  tax_amount: number;
  amount_total: number;
  rate: number;
  related_bill: string | null;
  supplier_name: string | null;
  customer_name: string | null;
  status: string;
}

const STATUS_LABEL: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }> = {
  pending: { label: '待勾选', variant: 'outline' },
  checked: { label: '已勾选', variant: 'secondary' },
  filed: { label: '已申报', variant: 'default' },
  void: { label: '已作废', variant: 'destructive' },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_LABEL[status] ?? { label: status, variant: 'outline' as const };
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

export default function InvoicesPage() {
  const { can } = useAuth();
  const canWrite = can('tax.write');
  const [searchInput, setSearchInput] = useState('');
  const [direction, setDirection] = useState('');
  const [status, setStatus] = useState('');
  const [invoiceType, setInvoiceType] = useState('');
  const list = usePagedList<InvoiceRow>('/api/tax/invoices', 10, { direction, status, invoice_type: invoiceType });
  const [createOpen, setCreateOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function act(row: InvoiceRow, action: 'mark' | 'delete', nextStatus?: string) {
    setBusyId(row.id);
    try {
      if (action === 'mark') {
        await apiFetch(`/api/tax/invoices/${row.id}/mark`, {
          method: 'POST',
          body: JSON.stringify({ status: nextStatus }),
        });
        toast.success('状态已更新');
      } else {
        await apiFetch(`/api/tax/invoices/${row.id}`, { method: 'DELETE' });
        toast.success('发票已删除');
      }
      list.reload();
    } catch (err) {
      toast.error('操作失败', { description: (err as Error).message });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold text-stone-900">发票台账</h1>
          <p className="text-xs text-stone-500 sm:text-sm">
            进项/销项发票登记 · 勾选认证 · 申报标记（关联采购/销售单号）
          </p>
        </div>
        {canWrite && (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1 h-4 w-4" />
            录入发票
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Select value={direction || 'all'} onValueChange={(v) => setDirection(v === 'all' ? '' : v)}>
          <SelectTrigger className="h-9 w-full sm:w-28"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部方向</SelectItem>
            <SelectItem value="input">进项</SelectItem>
            <SelectItem value="output">销项</SelectItem>
          </SelectContent>
        </Select>
        <Select value={invoiceType || 'all'} onValueChange={(v) => setInvoiceType(v === 'all' ? '' : v)}>
          <SelectTrigger className="h-9 w-full sm:w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部类型</SelectItem>
            <SelectItem value="special">专用发票</SelectItem>
            <SelectItem value="normal">普通发票</SelectItem>
          </SelectContent>
        </Select>
        <Select value={status || 'all'} onValueChange={(v) => setStatus(v === 'all' ? '' : v)}>
          <SelectTrigger className="h-9 w-full sm:w-28"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部状态</SelectItem>
            <SelectItem value="pending">待勾选</SelectItem>
            <SelectItem value="checked">已勾选</SelectItem>
            <SelectItem value="filed">已申报</SelectItem>
            <SelectItem value="void">已作废</SelectItem>
          </SelectContent>
        </Select>
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') list.setKeyword(searchInput); }}
          placeholder="发票号 / 关联单 / 往来单位，回车搜索"
          className="h-9 w-full sm:w-64"
        />
        <Button variant="outline" size="sm" onClick={() => list.setKeyword(searchInput)} aria-label="搜索">
          <Search className="h-4 w-4 sm:mr-1" />
          <span className="hidden sm:inline">搜索</span>
        </Button>
      </div>

      {list.loading ? (
        <div className="rounded-lg border border-stone-200 bg-white p-4">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="mt-2 h-8 w-full" />
          <Skeleton className="mt-2 h-8 w-full" />
        </div>
      ) : list.items.length === 0 ? (
        <div className="rounded-lg border border-stone-200 bg-stone-50 p-10 text-center text-sm text-stone-500">
          <FileText className="mx-auto mb-2 h-8 w-8 text-stone-300" />
          暂无发票记录
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>发票号</TableHead>
                <TableHead>方向</TableHead>
                <TableHead>类型</TableHead>
                <TableHead>开票日期</TableHead>
                <TableHead className="text-right">不含税</TableHead>
                <TableHead className="text-right">税额</TableHead>
                <TableHead className="text-right">价税合计</TableHead>
                <TableHead>关联单</TableHead>
                <TableHead>往来单位</TableHead>
                <TableHead>状态</TableHead>
                {canWrite && <TableHead className="text-right">操作</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.items.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-mono text-xs">{row.invoice_no}</TableCell>
                  <TableCell>
                    <Badge variant={row.direction === 'output' ? 'default' : 'secondary'}>
                      {row.direction === 'output' ? '销项' : '进项'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-stone-600">{row.invoice_type === 'special' ? '专用' : '普通'}</TableCell>
                  <TableCell className="text-xs tabular-nums">{row.invoice_date}</TableCell>
                  <TableCell className="text-right tabular-nums">¥{formatMoney(row.amount_ex_tax)}</TableCell>
                  <TableCell className="text-right tabular-nums">¥{formatMoney(row.tax_amount)}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">¥{formatMoney(row.amount_total)}</TableCell>
                  <TableCell className="text-xs text-stone-500">{row.related_bill ?? '—'}</TableCell>
                  <TableCell className="text-xs text-stone-600">{row.supplier_name ?? row.customer_name ?? '—'}</TableCell>
                  <TableCell><StatusBadge status={row.status} /></TableCell>
                  {canWrite && (
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {row.status === 'pending' && (
                          <Button size="sm" variant="ghost" disabled={busyId === row.id} onClick={() => act(row, 'mark', 'checked')} title="勾选认证">
                            <CheckCheck className="h-4 w-4 text-green-600" />
                          </Button>
                        )}
                        {row.status === 'checked' && (
                          <Button size="sm" variant="ghost" disabled={busyId === row.id} onClick={() => act(row, 'mark', 'filed')} title="标记申报">
                            <Send className="h-4 w-4 text-blue-600" />
                          </Button>
                        )}
                        {row.status !== 'void' && row.status !== 'filed' && (
                          <Button size="sm" variant="ghost" disabled={busyId === row.id} onClick={() => act(row, 'mark', 'void')} title="作废">
                            <Ban className="h-4 w-4 text-stone-500" />
                          </Button>
                        )}
                        {row.status !== 'filed' && (
                          <Button size="sm" variant="ghost" disabled={busyId === row.id} onClick={() => act(row, 'delete')} title="删除">
                            <Trash2 className="h-4 w-4 text-red-500" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {list.total > 0 && (
        <PaginationControls page={list.page} pageSize={list.pageSize} total={list.total} onPageChange={list.setPage} />
      )}

      <InvoiceFormDialog open={createOpen} onOpenChange={setCreateOpen} onSaved={list.reload} />
    </div>
  );
}
