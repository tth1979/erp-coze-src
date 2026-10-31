'use client';

import { useState } from 'react';
import { Landmark, Plus, Search, Trash2 } from 'lucide-react';
import { useAuth } from '@/components/auth/auth-provider';
import { formatMoney } from '@/components/finance/balance-list';
import { FixedAssetFormDialog, type FixedAssetDetail } from '@/components/finance/fixed-asset-form-dialog';
import { FixedAssetDetailSheet, statusBadge } from '@/components/finance/fixed-asset-detail-sheet';
import { DeleteConfirmDialog } from '@/components/master-data/delete-confirm-dialog';
import { PaginationControls } from '@/components/master-data/pagination-controls';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { usePagedList } from '@/lib/use-paged-list';

interface FixedAssetRow {
  id: string;
  asset_no: string;
  name: string;
  category: string | null;
  original_value: number;
  salvage_value: number;
  useful_life: number;
  acquisition_date: string;
  status: string;
  accrued: number;
  net_value: number;
  months_accrued: number;
  monthly_depreciation: number;
}

const CATEGORY_OPTIONS = ['房屋建筑', '机器设备', '运输设备', '办公设备', '电子设备', '其他'];

export default function FixedAssetsPage() {
  const { can } = useAuth();
  const canWrite = can('fin.write');
  const [searchInput, setSearchInput] = useState('');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('');
  const list = usePagedList<FixedAssetRow>('/api/fin/fixed-assets', 10, { category, status });
  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FixedAssetRow | null>(null);

  function handleSaved(_: FixedAssetDetail) {
    setCreateOpen(false);
    list.reload();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold text-stone-900">固定资产</h1>
          <p className="text-xs text-stone-500 sm:text-sm">
            资产卡片 · 直线法折旧 · 入账次月起计提 · 处置自动生成凭证（FR-FIN-020）
          </p>
        </div>
        {canWrite && (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1 h-4 w-4" />
            新建资产卡片
          </Button>
        )}
      </div>

      {/* 筛选栏 */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Select value={category || 'all'} onValueChange={(v) => setCategory(v === 'all' ? '' : v)}>
          <SelectTrigger className="h-9 w-full sm:w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部类别</SelectItem>
            {CATEGORY_OPTIONS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={status || 'all'} onValueChange={(v) => setStatus(v === 'all' ? '' : v)}>
          <SelectTrigger className="h-9 w-full sm:w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部状态</SelectItem>
            <SelectItem value="in_use">在用</SelectItem>
            <SelectItem value="fully_depreciated">已折旧完</SelectItem>
            <SelectItem value="disposed">已处置</SelectItem>
          </SelectContent>
        </Select>
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') list.setKeyword(searchInput); }}
          placeholder="按编码 / 名称搜索，回车确认"
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
          <Skeleton className="mt-2 h-8 w-full" />
        </div>
      ) : list.total === 0 ? (
        <div className="rounded-lg border border-stone-200 bg-white p-8 text-center">
          <Landmark className="mx-auto mb-2 h-8 w-8 text-stone-300" />
          <p className="text-sm text-stone-500">
            {list.keyword || category || status ? '没有符合条件的资产' : '暂无固定资产，点击右上角新建卡片'}
          </p>
        </div>
      ) : (
        <>
          {/* 移动端：卡片 */}
          <div className="grid gap-2.5 lg:hidden">
            {list.items.map((row) => (
              <button
                key={row.id}
                type="button"
                onClick={() => setDetailId(row.id)}
                className="rounded-lg border border-stone-200 bg-white p-3.5 text-left shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-mono text-xs text-stone-500">{row.asset_no}</span>
                      {statusBadge(row.status)}
                    </div>
                    <div className="mt-1 truncate text-sm font-medium text-stone-900">{row.name}</div>
                  </div>
                  <span className="shrink-0 text-base font-bold tabular-nums text-stone-900">
                    ¥{formatMoney(row.net_value)}
                  </span>
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <dt className="text-stone-500">原值 / 残值</dt>
                    <dd className="mt-0.5 tabular-nums text-stone-800">{formatMoney(row.original_value)} / {formatMoney(row.salvage_value)}</dd>
                  </div>
                  <div>
                    <dt className="text-stone-500">累计折旧（{row.months_accrued} 期）</dt>
                    <dd className="mt-0.5 tabular-nums text-amber-700">{formatMoney(row.accrued)}</dd>
                  </div>
                </dl>
              </button>
            ))}
          </div>

          {/* 桌面端：表格 */}
          <div className="hidden overflow-x-auto rounded-lg border border-stone-200 bg-white lg:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>编码</TableHead>
                  <TableHead>名称</TableHead>
                  <TableHead>类别</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="text-right">原值</TableHead>
                  <TableHead className="text-right">累计折旧</TableHead>
                  <TableHead className="text-right">净值</TableHead>
                  <TableHead className="text-right">月折旧</TableHead>
                  <TableHead>入账日期</TableHead>
                  {canWrite && <TableHead className="w-16">操作</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.items.map((row) => (
                  <TableRow key={row.id} className="cursor-pointer" onClick={() => setDetailId(row.id)}>
                    <TableCell className="font-mono text-xs">{row.asset_no}</TableCell>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell className="text-stone-600">{row.category ?? '—'}</TableCell>
                    <TableCell>{statusBadge(row.status)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(row.original_value)}</TableCell>
                    <TableCell className="text-right tabular-nums text-amber-700">{formatMoney(row.accrued)}</TableCell>
                    <TableCell className="text-right tabular-nums font-semibold text-emerald-700">{formatMoney(row.net_value)}</TableCell>
                    <TableCell className="text-right tabular-nums text-stone-600">{formatMoney(row.monthly_depreciation)}</TableCell>
                    <TableCell className="text-stone-600">{row.acquisition_date}</TableCell>
                    {canWrite && (
                      <TableCell>
                        {row.status !== 'disposed' && row.months_accrued === 0 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label="删除"
                            onClick={(e) => { e.stopPropagation(); setDeleteTarget(row); }}
                          >
                            <Trash2 className="h-4 w-4 text-stone-400" />
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <PaginationControls
            page={list.page}
            pageSize={list.pageSize}
            total={list.total}
            onPageChange={list.setPage}
          />
        </>
      )}

      <FixedAssetFormDialog open={createOpen} onOpenChange={setCreateOpen} onSaved={handleSaved} />
      <FixedAssetDetailSheet
        assetId={detailId}
        open={detailId !== null}
        onOpenChange={(v) => { if (!v) setDetailId(null); }}
        canWrite={canWrite}
        onChanged={() => list.reload()}
      />
      <DeleteConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(v) => { if (!v) setDeleteTarget(null); }}
        endpoint={deleteTarget ? `/api/fin/fixed-assets/${deleteTarget.id}` : null}
        name={deleteTarget ? `${deleteTarget.name}（${deleteTarget.asset_no}）` : ''}
        onDeleted={() => list.reload()}
      />
    </div>
  );
}
