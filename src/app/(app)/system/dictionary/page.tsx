'use client';

import { useState } from 'react';
import { Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/components/auth/auth-provider';
import { usePagedList } from '@/lib/use-paged-list';
import { apiFetch, ApiClientError } from '@/lib/api-client';
import type { DictItemView, DictTypeView } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PaginationControls } from '@/components/master-data/pagination-controls';
import { DeleteConfirmDialog } from '@/components/master-data/delete-confirm-dialog';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

export default function DictionaryPage() {
  const { can } = useAuth();
  const writable = can('md.write');

  const types = usePagedList<DictTypeView>('/api/dict/types');
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const items = usePagedList<DictItemView>('/api/dict/items', 10, selectedType ? { type: selectedType } : undefined);

  const [keywordInput, setKeywordInput] = useState('');
  const [typeDialog, setTypeDialog] = useState<{ id: string | null; type_code: string; name: string; description: string; sort: number; is_active: boolean } | null>(null);
  const [itemDialog, setItemDialog] = useState<{ id: string | null; item_code: string; label: string; sort: number; is_active: boolean; extra: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ kind: 'type' | 'item'; id: string; name: string } | null>(null);

  const activeType = types.items.find((t) => t.id === selectedType) ?? types.items[0] ?? null;

  const openItemsFor = (type: DictTypeView) => {
    setSelectedType(type.id);
    items.setKeyword('');
  };

  const saveType = async () => {
    if (!typeDialog) return;
    if (!typeDialog.type_code.trim() || !typeDialog.name.trim()) {
      toast.error('类型编码、名称均为必填');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        type_code: typeDialog.type_code.trim(),
        name: typeDialog.name.trim(),
        description: typeDialog.description || null,
        sort: typeDialog.sort,
        is_active: typeDialog.is_active,
      };
      if (typeDialog.id) {
        await apiFetch(`/api/dict/types/${typeDialog.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        await apiFetch('/api/dict/types', { method: 'POST', body: JSON.stringify(payload) });
      }
      toast.success('字典类型已保存');
      setTypeDialog(null);
      types.reload();
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const saveItem = async () => {
    if (!itemDialog) return;
    if (!itemDialog.item_code.trim() || !itemDialog.label.trim()) {
      toast.error('字典项编码、名称均为必填');
      return;
    }
    if (!activeType) {
      toast.error('请先选择字典类型');
      return;
    }
    setSaving(true);
    try {
      let extra: Record<string, unknown> | null = null;
      if (itemDialog.extra.trim()) {
        try {
          extra = JSON.parse(itemDialog.extra) as Record<string, unknown>;
        } catch {
          toast.error('扩展属性须为合法 JSON');
          return;
        }
      }
      const payload = {
        type_code: activeType.type_code,
        item_code: itemDialog.item_code.trim(),
        label: itemDialog.label.trim(),
        sort: itemDialog.sort,
        is_active: itemDialog.is_active,
        extra,
      };
      if (itemDialog.id) {
        await apiFetch(`/api/dict/items/${itemDialog.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        await apiFetch('/api/dict/items', { method: 'POST', body: JSON.stringify(payload) });
      }
      toast.success('字典项已保存');
      setItemDialog(null);
      items.reload();
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold">数据字典</h1>
          <p className="text-sm text-muted-foreground">维护计量单位、付款方式、税率、客户等级、状态等枚举，供各模块下拉引用</p>
        </div>
        {writable && (
          <Button
            className="shrink-0"
            onClick={() => setTypeDialog({ id: null, type_code: '', name: '', description: '', sort: 0, is_active: true })}
          >
            <Plus className="h-4 w-4" />
            新增类型
          </Button>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(220px,280px)_1fr]">
        {/* 类型列表 */}
        <div className="rounded-lg border bg-card">
          <form
            className="flex gap-2 border-b p-2"
            onSubmit={(e) => {
              e.preventDefault();
              types.setKeyword(keywordInput);
            }}
          >
            <Input placeholder="搜索类型" value={keywordInput} onChange={(e) => setKeywordInput(e.target.value)} className="h-9" />
            <Button type="submit" variant="outline" size="sm" className="px-2">
              <Search className="h-4 w-4" />
            </Button>
          </form>
          <div className="max-h-[620px] overflow-y-auto p-1.5">
            {types.loading ? (
              Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="mb-1.5 h-9 w-full" />)
            ) : types.items.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">暂无字典类型</div>
            ) : (
              types.items.map((t) => (
                <div
                  key={t.id}
                  onClick={() => openItemsFor(t)}
                  className={cn(
                    'group mb-0.5 flex cursor-pointer items-center justify-between rounded-md px-2.5 py-2 text-sm',
                    activeType?.id === t.id ? 'bg-stone-900 text-stone-50' : 'text-stone-700 hover:bg-stone-100',
                  )}
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium tabular-nums">{t.type_code}</div>
                    <div className={cn('truncate text-xs', activeType?.id === t.id ? 'text-stone-300' : 'text-muted-foreground')}>
                      {t.name}
                    </div>
                  </div>
                  {writable && (
                    <div className="ml-1 flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setTypeDialog({ id: t.id, type_code: t.type_code, name: t.name, description: t.description ?? '', sort: t.sort, is_active: t.is_active });
                        }}
                        className="rounded p-1 hover:bg-white/10"
                        aria-label="编辑类型"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      {!t.is_system && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteTarget({ kind: 'type', id: t.id, name: t.type_code });
                          }}
                          className="rounded p-1 hover:bg-white/10"
                          aria-label="删除类型"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
          {types.total > types.pageSize && (
            <div className="border-t p-2">
              <PaginationControls page={types.page} total={types.total} pageSize={types.pageSize} onPageChange={types.setPage} />
            </div>
          )}
        </div>

        {/* 字典项 */}
        <div className="rounded-lg border bg-card">
          <div className="flex items-center justify-between gap-2 border-b p-3">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold">{activeType ? `${activeType.name}（${activeType.type_code}）` : '字典项'}</h2>
              <p className="text-xs text-muted-foreground">{activeType?.description ?? ''}</p>
            </div>
            {writable && activeType && (
              <Button size="sm" variant="outline" onClick={() => setItemDialog({ id: null, item_code: '', label: '', sort: 0, is_active: true, extra: '' })}>
                <Plus className="h-4 w-4" />
                新增字典项
              </Button>
            )}
          </div>
          {!activeType ? (
            <div className="py-14 text-center text-sm text-muted-foreground">请先选择或新增一个字典类型</div>
          ) : items.loading ? (
            <div className="space-y-1.5 p-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : items.items.length === 0 ? (
            <div className="py-14 text-center text-sm text-muted-foreground">该类型下暂无字典项</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>编码</TableHead>
                  <TableHead>名称</TableHead>
                  <TableHead>扩展</TableHead>
                  <TableHead>排序</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.items.map((it) => (
                  <TableRow key={it.id}>
                    <TableCell className="font-medium tabular-nums">{it.item_code}</TableCell>
                    <TableCell>{it.label}</TableCell>
                    <TableCell className="max-w-[160px] truncate text-xs text-muted-foreground">
                      {it.extra ? JSON.stringify(it.extra) : '-'}
                    </TableCell>
                    <TableCell className="tabular-nums">{it.sort}</TableCell>
                    <TableCell>
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                          it.is_active ? 'bg-green-50 text-green-700' : 'bg-stone-100 text-stone-500'
                        }`}
                      >
                        {it.is_active ? '启用' : '停用'}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      {writable && (
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              setItemDialog({
                                id: it.id,
                                item_code: it.item_code,
                                label: it.label,
                                sort: it.sort,
                                is_active: it.is_active,
                                extra: it.extra ? JSON.stringify(it.extra) : '',
                              })
                            }
                            aria-label="编辑"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setDeleteTarget({ kind: 'item', id: it.id, name: it.label })} aria-label="删除">
                            <Trash2 className="h-4 w-4 text-red-600" />
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {activeType && (
            <PaginationControls page={items.page} total={items.total} pageSize={items.pageSize} onPageChange={items.setPage} />
          )}
        </div>
      </div>

      {/* 类型编辑对话框 */}
      <Dialog open={typeDialog !== null} onOpenChange={(o) => !o && setTypeDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{typeDialog?.id ? '编辑字典类型' : '新增字典类型'}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <Label className="space-y-1">
              类型编码
              <Input
                disabled={Boolean(typeDialog?.id)}
                value={typeDialog?.type_code ?? ''}
                onChange={(e) => setTypeDialog((f) => (f ? { ...f, type_code: e.target.value } : f))}
                placeholder="如 unit"
              />
            </Label>
            <Label className="space-y-1">
              类型名称
              <Input value={typeDialog?.name ?? ''} onChange={(e) => setTypeDialog((f) => (f ? { ...f, name: e.target.value } : f))} placeholder="如 计量单位" />
            </Label>
            <Label className="col-span-2 space-y-1">
              说明
              <Input value={typeDialog?.description ?? ''} onChange={(e) => setTypeDialog((f) => (f ? { ...f, description: e.target.value } : f))} />
            </Label>
            <Label className="space-y-1">
              排序
              <Input
                type="number"
                value={typeDialog?.sort ?? 0}
                onChange={(e) => setTypeDialog((f) => (f ? { ...f, sort: Number(e.target.value) || 0 } : f))}
              />
            </Label>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setTypeDialog(null)}>
              取消
            </Button>
            <Button onClick={saveType} disabled={saving}>
              {saving ? '保存中…' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 字典项编辑对话框 */}
      <Dialog open={itemDialog !== null} onOpenChange={(o) => !o && setItemDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{itemDialog?.id ? '编辑字典项' : '新增字典项'}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <Label className="space-y-1">
              项编码
              <Input value={itemDialog?.item_code ?? ''} onChange={(e) => setItemDialog((f) => (f ? { ...f, item_code: e.target.value } : f))} placeholder="如 piece" />
            </Label>
            <Label className="space-y-1">
              显示名
              <Input value={itemDialog?.label ?? ''} onChange={(e) => setItemDialog((f) => (f ? { ...f, label: e.target.value } : f))} placeholder="如 片" />
            </Label>
            <Label className="space-y-1">
              排序
              <Input
                type="number"
                value={itemDialog?.sort ?? 0}
                onChange={(e) => setItemDialog((f) => (f ? { ...f, sort: Number(e.target.value) || 0 } : f))}
              />
            </Label>
            <Label className="space-y-1">
              状态
              <select
                value={itemDialog?.is_active ? '1' : '0'}
                onChange={(e) => setItemDialog((f) => (f ? { ...f, is_active: e.target.value === '1' } : f))}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="1">启用</option>
                <option value="0">停用</option>
              </select>
            </Label>
            <Label className="col-span-2 space-y-1">
              扩展属性（JSON，可空）
              <Input value={itemDialog?.extra ?? ''} onChange={(e) => setItemDialog((f) => (f ? { ...f, extra: e.target.value } : f))} placeholder='如 {"discount_rate":0.95}' className="font-mono text-xs" />
            </Label>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setItemDialog(null)}>
              取消
            </Button>
            <Button onClick={saveItem} disabled={saving}>
              {saving ? '保存中…' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DeleteConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        endpoint={deleteTarget ? (deleteTarget.kind === 'type' ? `/api/dict/types/${deleteTarget.id}` : `/api/dict/items/${deleteTarget.id}`) : null}
        name={deleteTarget?.name ?? ''}
        onDeleted={() => {
          const kind = deleteTarget?.kind;
          setDeleteTarget(null);
          if (kind === 'type') {
            setSelectedType(null);
            types.reload();
          } else {
            items.reload();
          }
        }}
      />
    </div>
  );
}