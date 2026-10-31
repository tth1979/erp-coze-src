'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { MapPin, Plus, Search, Trash2 } from 'lucide-react';
import { useAuth } from '@/components/auth/auth-provider';
import { formatMoney } from '@/components/finance/balance-list';
import { PrepaidFormDialog } from '@/components/tax/prepaid-form-dialog';
import { PaginationControls } from '@/components/master-data/pagination-controls';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { apiFetch } from '@/lib/api-client';
import { usePagedList } from '@/lib/use-paged-list';

interface PrepaidRow {
  id: string;
  period: string;
  project: string;
  region: string | null;
  prepaid_amount: number;
  based_tax: number;
  prepaid_date: string;
  related: string | null;
  status: string;
}

export default function PrepaidPage() {
  const { can } = useAuth();
  const canWrite = can('tax.write');
  const [searchInput, setSearchInput] = useState('');
  const list = usePagedList<PrepaidRow>('/api/tax/prepaid', 10);
  const [createOpen, setCreateOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const totalPrepaid = list.items.reduce((s, r) => s + r.prepaid_amount, 0);

  async function handleDelete(row: PrepaidRow) {
    setBusyId(row.id);
    try {
      await apiFetch(`/api/tax/prepaid/${row.id}`, { method: 'DELETE' });
      toast.success('已删除');
      list.reload();
    } catch (err) {
      toast.error('删除失败', { description: (err as Error).message });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold text-stone-900">异地预缴</h1>
          <p className="text-xs text-stone-500 sm:text-sm">
            工程项目地预缴增值税登记 · 申报时抵减应纳税额
          </p>
        </div>
        {canWrite && (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1 h-4 w-4" />
            登记预缴
          </Button>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') list.setKeyword(searchInput); }}
          placeholder="项目 / 地区 / 关联单，回车搜索"
          className="h-9 w-full sm:w-72"
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
        </div>
      ) : list.items.length === 0 ? (
        <div className="rounded-lg border border-stone-200 bg-stone-50 p-10 text-center text-sm text-stone-500">
          <MapPin className="mx-auto mb-2 h-8 w-8 text-stone-300" />
          暂无异地预缴记录
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>所属期间</TableHead>
                  <TableHead>工程项目</TableHead>
                  <TableHead>项目地</TableHead>
                  <TableHead className="text-right">预缴税额</TableHead>
                  <TableHead className="text-right">计税依据</TableHead>
                  <TableHead>预缴日期</TableHead>
                  <TableHead>关联</TableHead>
                  <TableHead>状态</TableHead>
                  {canWrite && <TableHead className="text-right">操作</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.items.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="tabular-nums text-xs">{row.period}</TableCell>
                    <TableCell className="text-sm">{row.project}</TableCell>
                    <TableCell className="text-xs text-stone-600">{row.region ?? '—'}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums text-red-600">¥{formatMoney(row.prepaid_amount)}</TableCell>
                    <TableCell className="text-right tabular-nums">¥{formatMoney(row.based_tax)}</TableCell>
                    <TableCell className="text-xs tabular-nums">{row.prepaid_date}</TableCell>
                    <TableCell className="text-xs text-stone-500">{row.related ?? '—'}</TableCell>
                    <TableCell>
                      <Badge variant={row.status === 'active' ? 'secondary' : 'destructive'}>
                        {row.status === 'active' ? '有效' : '作废'}
                      </Badge>
                    </TableCell>
                    {canWrite && (
                      <TableCell className="text-right">
                        <Button size="sm" variant="ghost" disabled={busyId === row.id} onClick={() => handleDelete(row)} title="删除">
                          <Trash2 className="h-4 w-4 text-red-500" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-stone-500">
            <span>本页预缴合计：<span className="font-semibold text-stone-700">¥{formatMoney(totalPrepaid)}</span></span>
            <PaginationControls page={list.page} pageSize={list.pageSize} total={list.total} onPageChange={list.setPage} />
          </div>
        </>
      )}

      <PrepaidFormDialog open={createOpen} onOpenChange={setCreateOpen} onSaved={list.reload} />
    </div>
  );
}
