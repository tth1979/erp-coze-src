'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, Warehouse } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/components/auth/auth-provider';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { apiFetch, ApiClientError } from '@/lib/api-client';
import type { InvWarehouse } from '@/lib/types';

function WarehouseFormDialog({
  open,
  editing,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  editing: InvWarehouse | null;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setCode(editing?.code ?? '');
      setName(editing?.name ?? '');
      setAddress(editing?.address ?? '');
    }
  }, [open, editing]);

  async function submit() {
    setSaving(true);
    try {
      const payload = { code: code.trim(), name: name.trim(), address: address.trim() || undefined };
      if (editing) {
        await apiFetch(`/api/inv/warehouses/${editing.id}`, {
          method: 'PUT',
          body: JSON.stringify({ name: payload.name, address: payload.address }),
        });
        toast.success('仓库已更新');
      } else {
        await apiFetch('/api/inv/warehouses', { method: 'POST', body: JSON.stringify(payload) });
        toast.success('仓库已创建');
      }
      onOpenChange(false);
      onDone();
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{editing ? '编辑仓库' : '新增仓库'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="wh-code">仓库编码</Label>
            <Input
              id="wh-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="如 WH02"
              disabled={!!editing}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wh-name">仓库名称</Label>
            <Input id="wh-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="如 二号仓" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wh-address">地址</Label>
            <Input
              id="wh-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="选填"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={submit} disabled={saving || !code.trim() || !name.trim()}>
            {saving ? '保存中…' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function WarehousesPage() {
  const { can } = useAuth();
  const canWrite = can('inv.write');
  const [items, setItems] = useState<InvWarehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<InvWarehouse | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<{ items: InvWarehouse[] }>('/api/inv/warehouses');
      setItems(data.items);
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleActive(row: InvWarehouse) {
    try {
      await apiFetch(`/api/inv/warehouses/${row.id}`, {
        method: 'PUT',
        body: JSON.stringify({ is_active: !row.is_active }),
      });
      toast.success(row.is_active ? `已停用「${row.name}」` : `已启用「${row.name}」`);
      await load();
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : '操作失败');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold text-stone-900">仓库档案</h1>
          <p className="text-xs text-stone-500 sm:text-sm">
            多仓台账的仓库主数据；停用后不可再作为单据出入仓，历史数据保留
          </p>
        </div>
        {canWrite ? (
          <Button
            size="sm"
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            <Plus className="mr-1 h-4 w-4" />
            新增仓库
          </Button>
        ) : null}
      </div>

      {loading ? (
        <div className="rounded-lg border border-stone-200 bg-white p-4">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="mt-2 h-8 w-full" />
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-stone-200 bg-white p-8 text-center">
          <Warehouse className="mx-auto mb-2 h-8 w-8 text-stone-300" />
          <p className="text-sm text-stone-500">暂无仓库，请先新增</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>编码</TableHead>
                <TableHead>名称</TableHead>
                <TableHead>地址</TableHead>
                <TableHead>启用</TableHead>
                {canWrite ? <TableHead className="text-right">操作</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-mono text-xs text-stone-700">{row.code}</TableCell>
                  <TableCell className="font-medium text-stone-800">{row.name}</TableCell>
                  <TableCell className="text-stone-600">{row.address ?? '—'}</TableCell>
                  <TableCell>
                    <Switch
                      checked={row.is_active}
                      disabled={!canWrite}
                      onCheckedChange={() => toggleActive(row)}
                      aria-label="启用状态"
                    />
                  </TableCell>
                  {canWrite ? (
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEditing(row);
                          setDialogOpen(true);
                        }}
                      >
                        编辑
                      </Button>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <WarehouseFormDialog open={dialogOpen} editing={editing} onOpenChange={setDialogOpen} onDone={() => void load()} />
    </div>
  );
}
