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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">供应商</h1>
          <p className="text-sm text-muted-foreground">维护瓷砖厂家与供货商的主数据</p>
        </div>
        {writable && (
          <Button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Plus className="h-4 w-4" />
            新增供应商
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
