'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { GitCompareArrows, Plus, Search, Trash2 } from 'lucide-react';
import { useAuth } from '@/components/auth/auth-provider';
import { formatMoney } from '@/components/finance/balance-list';
import { SocDiffFormDialog } from '@/components/tax/soc-diff-form-dialog';
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

interface SocDiffRow {
  id: string;
  period: string;
  diff_type: string;
  item: string;
  description: string | null;
  tax_base: number;
  accounting_base: number;
  diff_amount: number;
  status: string;
}

export default function TaxDiffPage() {
  const { can } = useAuth();
  const canWrite = can('tax.write');
  const [searchInput, setSearchInput] = useState('');
  const [diffType, setDiffType] = useState('');
  const list = usePagedList<SocDiffRow>('/api/tax/soc-diff', 10, { diff_type: diffType });
  const [createOpen, setCreateOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const tempAmount = list.items.filter((r) => r.diff_type === 'temporary').reduce((s, r) => s + r.diff_amount, 0);
  const permAmount = list.items.filter((r) => r.diff_type === 'permanent').reduce((s, r) => s + r.diff_amount, 0);

  async function handleDelete(row: SocDiffRow) {
    setBusyId(row.id);
    try {
      await apiFetch(`/api/tax/soc-diff/${row.id}`, { method: 'DELETE' });
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
          <h1 className="text-lg font-bold text-stone-900">税会差异</h1>
          <p className="text-xs text-stone-500 sm:text-sm">
            时间性差异日常提示 · 永久性差异留待汇算清缴 · 差异额 = 税法 − 会计
          </p>
        </div>
        {canWrite && (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1 h-4 w-4" />
            登记差异
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-stone-200 bg-white p-4">
          <div className="text-xs text-stone-500">时间性差异（本页合计）</div>
          <div className="mt-1 text-lg font-bold tabular-nums text-amber-600">¥{formatMoney(tempAmount)}</div>
        </div>
        <div className="rounded-lg border border-stone-200 bg-white p-4">
          <div className="text-xs text-stone-500">永久性差异（本页合计·汇算清缴）</div>
          <div className="mt-1 text-lg font-bold tabular-nums text-purple-600">¥{formatMoney(permAmount)}</div>
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Select value={diffType || 'all'} onValueChange={(v) => setDiffType(v === 'all' ? '' : v)}>
          <SelectTrigger className="h-9 w-full sm:w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部类型</SelectItem>
            <SelectItem value="temporary">时间性</SelectItem>
            <SelectItem value="permanent">永久性</SelectItem>
          </SelectContent>
        </Select>
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') list.setKeyword(searchInput); }}
          placeholder="差异项目 / 说明，回车搜索"
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
        </div>
      ) : list.items.length === 0 ? (
        <div className="rounded-lg border border-stone-200 bg-stone-50 p-10 text-center text-sm text-stone-500">
          <GitCompareArrows className="mx-auto mb-2 h-8 w-8 text-stone-300" />
          暂无税会差异记录
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>所属期间</TableHead>
                  <TableHead>类型</TableHead>
                  <TableHead>差异项目</TableHead>
                  <TableHead className="text-right">税法金额</TableHead>
                  <TableHead className="text-right">会计金额</TableHead>
                  <TableHead className="text-right">差异额</TableHead>
                  <TableHead>说明</TableHead>
                  {canWrite && <TableHead className="text-right">操作</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.items.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="tabular-nums text-xs">{row.period}</TableCell>
                    <TableCell>
                      <Badge variant={row.diff_type === 'permanent' ? 'default' : 'secondary'}>
                        {row.diff_type === 'permanent' ? '永久性' : '时间性'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">{row.item}</TableCell>
                    <TableCell className="text-right tabular-nums">¥{formatMoney(row.tax_base)}</TableCell>
                    <TableCell className="text-right tabular-nums">¥{formatMoney(row.accounting_base)}</TableCell>
                    <TableCell className={`text-right font-semibold tabular-nums ${row.diff_amount >= 0 ? 'text-red-600' : 'text-green-700'}`}>
                      ¥{formatMoney(row.diff_amount)}
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate text-xs text-stone-500">{row.description ?? '—'}</TableCell>
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
          <PaginationControls page={list.page} pageSize={list.pageSize} total={list.total} onPageChange={list.setPage} />
        </>
      )}

      <SocDiffFormDialog open={createOpen} onOpenChange={setCreateOpen} onSaved={list.reload} />
    </div>
  );
}
