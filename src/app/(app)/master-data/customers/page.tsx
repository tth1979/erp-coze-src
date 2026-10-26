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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">客户档案</h1>
          <p className="text-sm text-muted-foreground">维护经销商下游客户的主数据</p>
        </div>
        {writable && (
          <Button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Plus className="h-4 w-4" />
            新增客户
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
          className="max-w-xs"
          placeholder="搜索编码 / 名称 / 联系人 / 电话"
          value={keywordInput}
          onChange={(e) => setKeywordInput(e.target.value)}
        />
        <Button type="submit" variant="outline">
          <Search className="h-4 w-4" />
          搜索
        </Button>
      </form>

      <div className="rounded-lg border bg-card">
        <Table>
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
