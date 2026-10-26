'use client';

import { useState } from 'react';
import { Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useAuth } from '@/components/auth/auth-provider';
import { usePagedList } from '@/lib/use-paged-list';
import type { Customer } from '@/lib/types';
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
import { CustomerFormDialog } from '@/components/master-data/customer-form-dialog';

const LEVEL_LABELS: Record<string, string> = {
  normal: '普通客户',
  vip: 'VIP 客户',
  strategic: '战略客户',
};

export default function CustomersPage() {
  const { can } = useAuth();
  const writable = can('md.write');
  const list = usePagedList<Customer>('/api/md/customers');
  const [keywordInput, setKeywordInput] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Customer | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold">客户档案</h1>
          <p className="text-sm text-muted-foreground">维护经销商下游客户的主数据</p>
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
            <span className="hidden sm:inline">新增客户</span>
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
            暂无客户数据
          </div>
        ) : (
          list.items.map((c) => (
            <div key={c.id} className="rounded-lg border border-stone-200 bg-white p-3.5 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-stone-500">{c.code}</span>
                    <StatusBadge status={c.status} />
                  </div>
                  <div className="mt-1 truncate text-sm font-medium text-stone-900">{c.name}</div>
                </div>
                {writable && (
                  <div className="flex shrink-0 gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      aria-label="编辑"
                      onClick={() => {
                        setEditing(c);
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
                      onClick={() => setDeleteTarget(c)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                )}
              </div>
              <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                <div>
                  <span className="text-stone-500">联系人：</span>
                  <span className="text-stone-800">{c.contact ?? '-'}</span>
                </div>
                <div>
                  <span className="text-stone-500">电话：</span>
                  <span className="text-stone-800">{c.phone ?? '-'}</span>
                </div>
                <div>
                  <span className="text-stone-500">等级：</span>
                  <span className="text-stone-800">{LEVEL_LABELS[c.level] ?? c.level}</span>
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
        <Table className="min-w-[640px]">
          <TableHeader>
            <TableRow>
              <TableHead className="w-28">编码</TableHead>
              <TableHead>名称</TableHead>
              <TableHead>联系人</TableHead>
              <TableHead>电话</TableHead>
              <TableHead>等级</TableHead>
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
                  暂无客户数据
                </TableCell>
              </TableRow>
            ) : (
              list.items.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-mono text-xs">{c.code}</TableCell>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell>{c.contact ?? '-'}</TableCell>
                  <TableCell>{c.phone ?? '-'}</TableCell>
                  <TableCell>{LEVEL_LABELS[c.level] ?? c.level}</TableCell>
                  <TableCell>
                    <StatusBadge status={c.status} />
                  </TableCell>
                  {writable && (
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            setEditing(c);
                            setFormOpen(true);
                          }}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(c)}>
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

      <CustomerFormDialog open={formOpen} onOpenChange={setFormOpen} initial={editing} onSaved={list.reload} />
      <DeleteConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        endpoint={deleteTarget ? `/api/md/customers/${deleteTarget.id}` : null}
        name={deleteTarget?.name ?? ''}
        onDeleted={list.reload}
      />
    </div>
  );
}
