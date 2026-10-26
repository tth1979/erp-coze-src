'use client';

import { useState } from 'react';
import { Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/components/auth/auth-provider';
import { usePagedList } from '@/lib/use-paged-list';
import { apiFetch, ApiClientError } from '@/lib/api-client';
import type { MdUnit } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PaginationControls } from '@/components/master-data/pagination-controls';
import { DeleteConfirmDialog } from '@/components/master-data/delete-confirm-dialog';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';

interface FormState {
  id: string | null;
  unit_code: string;
  unit_name: string;
  base_unit: string;
  conversion_ratio: string;
  remark: string;
  is_active: boolean;
}

const EMPTY: FormState = {
  id: null,
  unit_code: '',
  unit_name: '',
  base_unit: 'piece',
  conversion_ratio: '1',
  remark: '',
  is_active: true,
};

export default function UnitsPage() {
  const { can } = useAuth();
  const writable = can('md.write');
  const list = usePagedList<MdUnit>('/api/md/units');
  const [keywordInput, setKeywordInput] = useState('');
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<MdUnit | null>(null);

  const openNew = () => setForm({ ...EMPTY });
  const openEdit = (unit: MdUnit) =>
    setForm({
      id: unit.id,
      unit_code: unit.unit_code,
      unit_name: unit.unit_name,
      base_unit: unit.base_unit,
      conversion_ratio: unit.conversion_ratio,
      remark: unit.remark ?? '',
      is_active: unit.is_active,
    });

  const save = async () => {
    if (!form) return;
    if (!form.unit_code.trim() || !form.unit_name.trim() || !form.base_unit.trim()) {
      toast.error('编码、名称、基准单位均为必填');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        unit_code: form.unit_code.trim(),
        unit_name: form.unit_name.trim(),
        base_unit: form.base_unit.trim(),
        conversion_ratio: form.conversion_ratio || '1',
        remark: form.remark,
        is_active: form.is_active,
      };
      if (form.id) {
        await apiFetch(`/api/md/units/${form.id}`, { method: 'PUT', body: JSON.stringify(payload) });
        toast.success('计量单位已更新');
      } else {
        await apiFetch('/api/md/units', { method: 'POST', body: JSON.stringify(payload) });
        toast.success('计量单位已新增');
      }
      setForm(null);
      list.reload();
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
          <h1 className="text-lg font-semibold">计量单位</h1>
          <p className="text-sm text-muted-foreground">维护单位档案与换算法则（1 本单位 = 换算系数 × 基准单位）</p>
        </div>
        {writable && (
          <Button className="shrink-0" onClick={openNew}>
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">新增单位</span>
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
          placeholder="搜索编码 / 名称"
          value={keywordInput}
          onChange={(e) => setKeywordInput(e.target.value)}
        />
        <Button type="submit" variant="outline" className="shrink-0 px-2 sm:px-4" aria-label="搜索">
          <Search className="h-4 w-4" />
          <span className="hidden sm:inline">搜索</span>
        </Button>
      </form>

      <div className="rounded-lg border bg-card">
        {list.loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : list.items.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">暂无计量单位</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>编码</TableHead>
                <TableHead>名称</TableHead>
                <TableHead>基准单位</TableHead>
                <TableHead className="text-right">换算系数</TableHead>
                <TableHead>备注</TableHead>
                <TableHead>状态</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.items.map((unit) => (
                <TableRow key={unit.id}>
                  <TableCell className="font-medium tabular-nums">{unit.unit_code}</TableCell>
                  <TableCell>{unit.unit_name}</TableCell>
                  <TableCell className="tabular-nums">{unit.base_unit}</TableCell>
                  <TableCell className="text-right tabular-nums">{unit.conversion_ratio}</TableCell>
                  <TableCell className="text-muted-foreground">{unit.remark ?? '-'}</TableCell>
                  <TableCell>
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        unit.is_active ? 'bg-green-50 text-green-700' : 'bg-stone-100 text-stone-500'
                      }`}
                    >
                      {unit.is_active ? '启用' : '停用'}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    {writable && (
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => openEdit(unit)} aria-label="编辑">
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setDeleteTarget(unit)} aria-label="删除">
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
        <PaginationControls page={list.page} total={list.total} pageSize={list.pageSize} onPageChange={list.setPage} />
      </div>

      <Dialog open={form !== null} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{form?.id ? '编辑计量单位' : '新增计量单位'}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <Label className="space-y-1">
              单位编码
              <Input value={form?.unit_code ?? ''} onChange={(e) => setForm((f) => (f ? { ...f, unit_code: e.target.value } : f))} placeholder="如 piece" />
            </Label>
            <Label className="space-y-1">
              单位名称
              <Input value={form?.unit_name ?? ''} onChange={(e) => setForm((f) => (f ? { ...f, unit_name: e.target.value } : f))} placeholder="如 片" />
            </Label>
            <Label className="space-y-1">
              基准单位
              <Input value={form?.base_unit ?? ''} onChange={(e) => setForm((f) => (f ? { ...f, base_unit: e.target.value } : f))} placeholder="如 piece" />
            </Label>
            <Label className="space-y-1">
              换算系数
              <Input
                type="number"
                step="0.0001"
                value={form?.conversion_ratio ?? ''}
                onChange={(e) => setForm((f) => (f ? { ...f, conversion_ratio: e.target.value } : f))}
              />
            </Label>
            <Label className="col-span-2 space-y-1">
              备注
              <Input value={form?.remark ?? ''} onChange={(e) => setForm((f) => (f ? { ...f, remark: e.target.value } : f))} />
            </Label>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setForm(null)}>
              取消
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? '保存中…' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DeleteConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        endpoint={deleteTarget ? `/api/md/units/${deleteTarget.id}` : null}
        name={deleteTarget?.unit_name ?? ''}
        onDeleted={() => {
          setDeleteTarget(null);
          list.reload();
        }}
      />
    </div>
  );
}