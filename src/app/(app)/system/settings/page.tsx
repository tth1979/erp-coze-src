'use client';

import { useEffect, useState } from 'react';
import { Lock, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/components/auth/auth-provider';
import { apiFetch, ApiClientError } from '@/lib/api-client';
import { usePagedList } from '@/lib/use-paged-list';
import { PaginationControls } from '@/components/master-data/pagination-controls';
import { DeleteConfirmDialog } from '@/components/master-data/delete-confirm-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface SettingView {
  id: string;
  key: string;
  name: string;
  value: string;
  value_type: 'number' | 'string' | 'boolean' | 'json';
  group_name: string | null;
  description: string | null;
  is_sensitive: boolean;
  is_system: boolean;
  updated_by_name: string | null;
  updated_at: string;
}

const TYPE_LABELS: Record<string, string> = { number: '数字', string: '字符串', boolean: '布尔', json: 'JSON' };

interface DialogState {
  id: string | null;
  key: string;
  name: string;
  value: string;
  value_type: string;
  group_name: string;
  description: string;
  is_sensitive: boolean;
}

export default function SettingsPage() {
  const { can, user } = useAuth();
  const writable = can('sys.write');
  const isAdmin = user?.role === 'admin';
  const [searchInput, setSearchInput] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const list = usePagedList<SettingView>('/api/system/settings', 10, { group: groupFilter });
  const [groups, setGroups] = useState<string[]>([]);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SettingView | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiFetch<{ groups: string[] }>('/api/system/settings?pageSize=1')
      .then((d) => setGroups(d.groups ?? []))
      .catch(() => undefined);
  }, []);

  const openEdit = (s: SettingView) =>
    setDialog({
      id: s.id,
      key: s.key,
      name: s.name,
      value: s.value,
      value_type: s.value_type,
      group_name: s.group_name ?? '',
      description: s.description ?? '',
      is_sensitive: s.is_sensitive,
    });

  const openCreate = () =>
    setDialog({ id: null, key: '', name: '', value: '', value_type: 'string', group_name: '', description: '', is_sensitive: false });

  const save = async () => {
    if (!dialog) return;
    if (!dialog.name.trim()) {
      toast.error('参数名称不能为空');
      return;
    }
    if (!dialog.id && !dialog.key.trim()) {
      toast.error('参数 key 不能为空');
      return;
    }
    if (dialog.value_type === 'number' && Number.isNaN(Number(dialog.value))) {
      toast.error('数字类型参数的值必须是有效数字');
      return;
    }
    if (dialog.value_type === 'boolean' && !['true', 'false'].includes(dialog.value)) {
      toast.error('布尔类型参数的值必须是 true 或 false');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: dialog.name.trim(),
        value: dialog.value,
        value_type: dialog.value_type,
        group_name: dialog.group_name || null,
        description: dialog.description || null,
        is_sensitive: dialog.is_sensitive,
      };
      if (dialog.id) {
        await apiFetch(`/api/system/settings/${dialog.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
      } else {
        await apiFetch('/api/system/settings', {
          method: 'POST',
          body: JSON.stringify({ ...payload, key: dialog.key.trim() }),
        });
      }
      toast.success('参数已保存');
      setDialog(null);
      list.reload();
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">参数中心</h1>
        <p className="text-sm text-muted-foreground">审批阈值、出材率基准、残值边界、工价系数等经营参数统一在此维护，业务模块只引用不重定义</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Input
            placeholder="搜索 key / 名称 / 说明"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') list.setKeyword(searchInput); }}
            className="w-64"
          />
          <Button variant="outline" size="sm" onClick={() => list.setKeyword(searchInput)} aria-label="搜索">
            <Search className="h-4 w-4" />
          </Button>
        </div>
        <Select value={groupFilter || 'all'} onValueChange={(v) => setGroupFilter(v === 'all' ? '' : v)}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="全部分组" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部分组</SelectItem>
            {groups.map((g) => (
              <SelectItem key={g} value={g}>{g}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="ml-auto">
          {writable && (
            <Button onClick={openCreate}>
              <Plus className="mr-2 h-4 w-4" /> 新增参数
            </Button>
          )}
        </div>
      </div>

      {list.loading ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>参数 key</TableHead>
                  <TableHead>名称</TableHead>
                  <TableHead>值</TableHead>
                  <TableHead>类型</TableHead>
                  <TableHead>分组</TableHead>
                  <TableHead>最近修改</TableHead>
                  <TableHead className="w-24">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.items.map((s) => {
                  const editable = writable && (!s.is_sensitive || isAdmin);
                  return (
                    <TableRow key={s.id}>
                      <TableCell className="font-mono text-sm">
                        <div className="flex items-center gap-1">
                          {s.is_sensitive && <Lock className="h-3.5 w-3.5 text-amber-500" aria-label="敏感参数" />}
                          {s.key}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{s.name}</div>
                        {s.description && <div className="text-xs text-muted-foreground">{s.description}</div>}
                      </TableCell>
                      <TableCell className="font-mono text-sm">{s.value}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{TYPE_LABELS[s.value_type] ?? s.value_type}</Badge>
                      </TableCell>
                      <TableCell>{s.group_name ?? '-'}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {s.updated_by_name ?? '-'}
                        <div className="text-xs">{new Date(s.updated_at).toLocaleDateString('zh-CN')}</div>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {editable && (
                            <Button size="sm" variant="ghost" onClick={() => openEdit(s)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                          )}
                          {writable && !s.is_system && (
                            <Button size="sm" variant="ghost" onClick={() => setDeleteTarget(s)}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {list.items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">暂无参数</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          <PaginationControls page={list.page} pageSize={list.pageSize} total={list.total} onPageChange={list.setPage} />
        </>
      )}

      <Dialog open={!!dialog} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialog?.id ? '编辑参数' : '新增参数'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {!dialog?.id && (
              <div className="space-y-2">
                <Label>参数 key</Label>
                <Input
                  value={dialog?.key ?? ''}
                  onChange={(e) => setDialog((prev) => (prev ? { ...prev, key: e.target.value } : prev))}
                  placeholder="如 approval.order.threshold"
                />
              </div>
            )}
            <div className="space-y-2">
              <Label>名称</Label>
              <Input value={dialog?.name ?? ''} onChange={(e) => setDialog((prev) => (prev ? { ...prev, name: e.target.value } : prev))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>值类型</Label>
                <Select
                  value={dialog?.value_type ?? 'string'}
                  onValueChange={(v) => setDialog((prev) => (prev ? { ...prev, value_type: v } : prev))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="string">字符串</SelectItem>
                    <SelectItem value="number">数字</SelectItem>
                    <SelectItem value="boolean">布尔</SelectItem>
                    <SelectItem value="json">JSON</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>值</Label>
                <Input value={dialog?.value ?? ''} onChange={(e) => setDialog((prev) => (prev ? { ...prev, value: e.target.value } : prev))} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>分组</Label>
              <Input
                value={dialog?.group_name ?? ''}
                onChange={(e) => setDialog((prev) => (prev ? { ...prev, group_name: e.target.value } : prev))}
                placeholder="如 审批阈值 / 出材率 / 残值边界 / 工价系数"
              />
            </div>
            <div className="space-y-2">
              <Label>说明</Label>
              <Input value={dialog?.description ?? ''} onChange={(e) => setDialog((prev) => (prev ? { ...prev, description: e.target.value } : prev))} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={dialog?.is_sensitive ?? false}
                onChange={(e) => setDialog((prev) => (prev ? { ...prev, is_sensitive: e.target.checked } : prev))}
                className="h-4 w-4"
              />
              敏感参数（仅 admin 可修改）
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>取消</Button>
            <Button onClick={() => void save()} disabled={saving}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DeleteConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        endpoint={deleteTarget ? `/api/system/settings/${deleteTarget.id}` : null}
        name={deleteTarget?.name ?? ''}
        onDeleted={() => {
          setDeleteTarget(null);
          list.reload();
        }}
      />
    </div>
  );
}
