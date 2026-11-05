'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Download, Eye, Plus, Search, Trash2 } from 'lucide-react';
import { useAuth } from '@/components/auth/auth-provider';
import { PaginationControls } from '@/components/master-data/pagination-controls';
import { DeleteConfirmDialog } from '@/components/master-data/delete-confirm-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { usePagedList } from '@/lib/use-paged-list';
import type { Quote } from '@/lib/types';

function formatMoney(value: number): string {
  return `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const STATUS_LABELS: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  draft: { label: '草稿', variant: 'secondary' },
  sent: { label: '已发出', variant: 'default' },
  accepted: { label: '已接受', variant: 'default' },
  converted: { label: '已转订单', variant: 'outline' },
  expired: { label: '已过期', variant: 'secondary' },
  void: { label: '已作废', variant: 'destructive' },
};

function QuoteStatusBadge({ status }: { status: string }) {
  const cfg = STATUS_LABELS[status] ?? { label: status, variant: 'secondary' as const };
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
}

export default function QuotesPage() {
  const router = useRouter();
  const { can } = useAuth();
  const canWrite = can('so.write');
  const [status, setStatus] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const list = usePagedList<Quote>('/api/sales/quotes', 10, { status });
  const [deleteTarget, setDeleteTarget] = useState<Quote | null>(null);

  function onExport() {
    const params = new URLSearchParams();
    if (list.keyword) params.set('keyword', list.keyword);
    if (status) params.set('status', status);
    const url = `/api/sales/quotes/export${params.size ? `?${params.toString()}` : ''}`;
    // 跨域兼容：fetch + blob 下载
    fetch(url)
      .then((res) => res.blob())
      .then((blob) => {
        const blobUrl = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = 'quotes.csv';
        link.click();
        window.URL.revokeObjectURL(blobUrl);
      })
      .catch(() => undefined);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold text-stone-900">报价单</h1>
          <p className="text-xs text-stone-500 sm:text-sm">向客户报价，接受后可一键转销售订单</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onExport}>
            <Download className="mr-1 h-4 w-4" />
            导出
          </Button>
          {canWrite ? (
            <Button size="sm" onClick={() => router.push('/sales/quotes/new')}>
              <Plus className="mr-1 h-4 w-4" />
              新建报价单
            </Button>
          ) : null}
        </div>
      </div>

      {/* 筛选栏 */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') list.setKeyword(searchInput);
          }}
          placeholder="按单号 / 备注搜索，回车确认"
          className="h-9 w-full sm:w-72"
        />
        <Select value={status || 'all'} onValueChange={(v) => { list.setPage(1); setStatus(v === 'all' ? '' : v); }}>
          <SelectTrigger className="h-9 w-full sm:w-36">
            <SelectValue placeholder="全部状态" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部状态</SelectItem>
            {Object.entries(STATUS_LABELS).map(([value, cfg]) => (
              <SelectItem key={value} value={value}>
                {cfg.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
      ) : list.total === 0 ? (
        <div className="rounded-lg border border-stone-200 bg-white p-8 text-center">
          <p className="text-sm text-stone-500">
            {list.keyword || status ? '没有符合条件的报价单' : '暂无报价单'}
          </p>
          {canWrite && !list.keyword && !status ? (
            <Button className="mt-3" size="sm" onClick={() => router.push('/sales/quotes/new')}>
              <Plus className="mr-1 h-4 w-4" />
              新建第一张报价单
            </Button>
          ) : null}
        </div>
      ) : (
        <>
          {/* 移动端卡片 */}
          <div className="grid gap-2.5 lg:hidden">
            {list.items.map((quote) => (
              <div key={quote.id} className="rounded-lg border border-stone-200 bg-white p-3.5 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-stone-500">{quote.quote_no}</span>
                      <QuoteStatusBadge status={quote.status} />
                    </div>
                    <div className="mt-0.5 truncate text-sm font-medium text-stone-900">
                      {quote.customer_name ?? '—'}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
                      <Link href={`/sales/quotes/${quote.id}`} aria-label="查看">
                        <Eye className="h-4 w-4" />
                      </Link>
                    </Button>
                    {canWrite && quote.status === 'draft' ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive"
                        onClick={() => setDeleteTarget(quote)}
                        aria-label="删除"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    ) : null}
                  </div>
                </div>
                <dl className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                  <div className="flex justify-between gap-2">
                    <dt className="text-stone-500">报价日期</dt>
                    <dd className="text-stone-800">{quote.quote_date}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-stone-500">有效期至</dt>
                    <dd className="text-stone-800">{quote.valid_until ?? '—'}</dd>
                  </div>
                </dl>
                <div className="mt-2.5 flex items-center justify-between border-t border-stone-100 pt-2.5">
                  <span className="text-xs text-stone-500">报价总额（折后）</span>
                  <span className="text-sm font-semibold tabular-nums text-stone-900">
                    {formatMoney(quote.total_amount)}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* 桌面端表格 */}
          <div className="hidden rounded-lg border border-stone-200 bg-white shadow-sm lg:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>单号</TableHead>
                  <TableHead>客户</TableHead>
                  <TableHead>报价日期</TableHead>
                  <TableHead>有效期至</TableHead>
                  <TableHead className="text-center">明细</TableHead>
                  <TableHead className="text-right">总额</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>业务员</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.items.map((quote) => (
                  <TableRow
                    key={quote.id}
                    className="cursor-pointer"
                    onClick={() => router.push(`/sales/quotes/${quote.id}`)}
                  >
                    <TableCell className="font-mono text-xs">{quote.quote_no}</TableCell>
                    <TableCell>{quote.customer_name ?? '—'}</TableCell>
                    <TableCell className="text-stone-600">{quote.quote_date}</TableCell>
                    <TableCell className="text-stone-600">{quote.valid_until ?? '—'}</TableCell>
                    <TableCell className="text-center text-stone-600">{quote.item_count}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {formatMoney(quote.total_amount)}
                    </TableCell>
                    <TableCell>
                      <QuoteStatusBadge status={quote.status} />
                    </TableCell>
                    <TableCell className="text-stone-600">{quote.salesman ?? '—'}</TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
                          <Link href={`/sales/quotes/${quote.id}`} aria-label="查看">
                            <Eye className="h-4 w-4" />
                          </Link>
                        </Button>
                        {canWrite && quote.status === 'draft' ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive"
                            onClick={() => setDeleteTarget(quote)}
                            aria-label="删除"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="rounded-lg border border-stone-200 bg-white shadow-sm">
            <PaginationControls
              page={list.page}
              pageSize={list.pageSize}
              total={list.total}
              onPageChange={list.setPage}
            />
          </div>
        </>
      )}

      <DeleteConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        endpoint={deleteTarget ? `/api/sales/quotes/${deleteTarget.id}` : null}
        name={deleteTarget?.quote_no ?? ''}
        onDeleted={list.reload}
      />
    </div>
  );
}
