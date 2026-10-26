'use client';

import { useState } from 'react';
import { Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useAuth } from '@/components/auth/auth-provider';
import { usePagedList } from '@/lib/use-paged-list';
import type { Supplier } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PaginationControls } from '@/components/master-data/pagination-controls';
import { StatusBadge } from '@/components/master-data/status-badge';
import { DeleteConfirmDialog } from '@/components/master-data/delete-confirm-dialog';
import { SupplierFormDialog } from '@/components/master-data/supplier-form-dialog';

export default function SuppliersPage() {
  const { can } = useAuth();
  const writable = can('md.write');
  const list = usePagedList<Supplier>('/api/md/suppliers');
  const [keywordInput, setKeywordInput] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Supplier | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold">供应商</h1>
          <p className="text-sm text-muted-foreground">维护瓷砖厂家与供货商的主数据</p>
        </div>
        {writable && (
          <Button
            className="shrink-0"
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">新增供应商</span>
            <span className="sm:hidden">新增</span>
          </Button>
        )}
      </div>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          list.setKeyword(keywordInput);
        }}
      >
        <Input
          className="w-full sm:max-w-xs"
          placeholder="搜索编码 / 名称 / 联系人 / 电话"
          value={keywordInput}
          onChange={(e) => setKeywordInput(e.target.value)}
        />
        <Button type="submit" variant="outline" className="shrink-0 px-2 sm:px-4" aria-label="搜索">
          <Search className="h-4 w-4" />
          <span className="hidden sm:inline">搜索</span>
        </Button>
      </form>

      {/* 移动端：购物车式卡片清单 */}
      <div className="space-y-2.5 lg:hidden">
        {list.loading ? (
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-lg" />)
        ) : list.items.length === 0 ? (
          <div className="rounded-lg border bg-card py-10 text-center text-sm text-muted-foreground">
            暂无供应商数据
          </div>
        ) : (
          list.items.map((s) => (
            <div key={s.id} className="rounded-lg border border-stone-200 bg-white p-3.5 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-stone-500">{s.code}</span>
                    <StatusBadge status={s.status} />
                  </div>
                  <div className="mt-1 truncate text-sm font-medium text-stone-900">{s.name}</div>
                </div>
                {writable && (
                  <div className="flex shrink-0 gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      aria-label="编辑"
                      onClick={() => {
                        setEditing(s);
                        setFormOpen(true);
                      }}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      aria-label="删除"
                      onClick={() => setDeleteTarget(s)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                )}
              </div>
              <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                <div>
                  <span className="text-stone-500">联系人：</span>
                  <span className="text-stone-800">{s.contact ?? '-'}</span>
                </div>
                <div>
                  <span className="text-stone-500">电话：</span>
                  <span className="text-stone-800">{s.phone ?? '-'}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-stone-500">结算方式：</span>
                  <span className="text-stone-800">{s.settlement ?? '-'}</span>
                </div>
              </div>
            </div>
          ))
        )}
        <div className="rounded-lg border bg-card px-3">
          <PaginationControls page={list.page} pageSize={list.pageSize} total={list.total} onPageChange={list.setPage} />
        </div>
      </div>

      {/* 桌面端：高密度表格 */}
      <div className="hidden rounded-lg border bg-card lg:block">
        <Table className="min-w-[680px]">
          <TableHeader>
            <TableRow>
              <TableHead className="w-28">编码</TableHead>
              <TableHead>名称</TableHead>
              <TableHead>联系人</TableHead>
              <TableHead>电话</TableHead>
              <TableHead>结算方式</TableHead>
              <TableHead>状态</TableHead>
              {writable && <TableHead className="w-24 text-right">操作</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={writable ? 7 : 6}>
                    <Skeleton className="h-6 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : list.items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={writable ? 7 : 6} className="py-10 text-center text-muted-foreground">
                  暂无供应商数据
                </TableCell>
              </TableRow>
            ) : (
              list.items.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-mono text-xs">{s.code}</TableCell>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell>{s.contact ?? '-'}</TableCell>
                  <TableCell>{s.phone ?? '-'}</TableCell>
                  <TableCell>{s.settlement ?? '-'}</TableCell>
                  <TableCell>
                    <StatusBadge status={s.status} />
                  </TableCell>
                  {writable && (
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            setEditing(s);
                            setFormOpen(true);
                          }}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(s)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        <div className="border-t px-3">
          <PaginationControls page={list.page} pageSize={list.pageSize} total={list.total} onPageChange={list.setPage} />
        </div>
      </div>

      <SupplierFormDialog open={formOpen} onOpenChange={setFormOpen} initial={editing} onSaved={list.reload} />
      <DeleteConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        endpoint={deleteTarget ? `/api/md/suppliers/${deleteTarget.id}` : null}
        name={deleteTarget?.name ?? ''}
        onDeleted={list.reload}
      />
    </div>
  );
}
