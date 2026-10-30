'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Pencil, Plus, Search, Trash2, ToggleLeft, ToggleRight } from 'lucide-react';
import { useAuth } from '@/components/auth/auth-provider';
import { formatMoney } from '@/components/finance/balance-list';
import { PaginationControls } from '@/components/master-data/pagination-controls';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { apiFetch } from '@/lib/api-client';

interface Subject {
  id: string;
  subject_code: string;
  subject_name: string;
  category: number;
  parent_code: string | null;
  direction: number;
  is_leaf: boolean;
  balance_flag: boolean;
  opening_amount: number;
  opening_direction: number;
  status: string;
  sort_no: number;
  remark: string | null;
}

const CATEGORY_LABELS: Record<number, string> = { 1: '资产', 2: '负债', 3: '共同', 4: '权益', 5: '成本', 6: '损益' };
const DIRECTION_LABELS: Record<number, string> = { 0: '借', 1: '贷' };

interface FormState {
  subject_code: string;
  subject_name: string;
  category: string;
  parent_code: string;
  direction: string;
  balance_flag: boolean;
  opening_amount: string;
  opening_direction: string;
  status: string;
  sort_no: string;
  remark: string;
}

const emptyForm: FormState = {
  subject_code: '',
  subject_name: '',
  category: '1',
  parent_code: '',
  direction: '0',
  balance_flag: true,
  opening_amount: '',
  opening_direction: '0',
  status: 'active',
  sort_no: '0',
  remark: '',
};

export default function SubjectsPage() {
  const { can } = useAuth();
  const canWrite = can('fin.write');
  const [searchInput, setSearchInput] = useState('');
  const [category, setCategory] = useState('__all');
  const list = usePagedList<Subject>('/api/fin/subjects', 20, { category: category === '__all' ? '' : category });
  const [edit, setEdit] = useState<Subject | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [delTarget, setDelTarget] = useState<Subject | null>(null);
  const [acting, setActing] = useState(false);

  const all = list.items;

  function openCreate() {
    setEdit(null);
    setForm(emptyForm);
    setCreating(true);
  }

  function openEdit(s: Subject) {
    setEdit(s);
    setForm({
      subject_code: s.subject_code,
      subject_name: s.subject_name,
      category: String(s.category),
      parent_code: s.parent_code ?? '',
      direction: String(s.direction),
      balance_flag: s.balance_flag,
      opening_amount: String(s.opening_amount ?? ''),
      opening_direction: String(s.opening_direction),
      status: s.status,
      sort_no: String(s.sort_no),
      remark: s.remark ?? '',
    });
    setCreating(true);
  }

  function patch(p: Partial<FormState>) {
    setForm((f) => ({ ...f, ...p }));
  }

  async function save() {
    setActing(true);
    try {
      const payload = {
        subject_code: form.subject_code.trim(),
        subject_name: form.subject_name.trim(),
        category: Number(form.category),
        parent_code: form.parent_code.trim() || null,
        direction: Number(form.direction),
        balance_flag: form.balance_flag,
        opening_amount: form.opening_amount === '' ? 0 : Number(form.opening_amount),
        opening_direction: Number(form.opening_direction),
        status: form.status,
        sort_no: Number(form.sort_no) || 0,
        remark: form.remark || null,
      };
      if (edit) {
        await apiFetch(`/api/fin/subjects/${edit.id}`, { method: 'PUT', body: JSON.stringify(payload) });
        toast.success('科目已更新');
      } else {
        await apiFetch('/api/fin/subjects', { method: 'POST', body: JSON.stringify(payload) });
        toast.success('科目已新增');
      }
      setCreating(false);
      list.reload();
    } catch (e) {
      toast.error('保存失败', { description: (e as Error).message });
    } finally {
      setActing(false);
    }
  }

  async function toggleStatus(s: Subject) {
    setActing(true);
    try {
      await apiFetch(`/api/fin/subjects/${s.id}`, {
        method: 'PUT',
        body: JSON.stringify({ status: s.status === 'active' ? 'disabled' : 'active' }),
      });
      list.reload();
    } catch (e) {
      toast.error('操作失败', { description: (e as Error).message });
    } finally {
      setActing(false);
    }
  }

  async function doDelete() {
    if (!delTarget) return;
    setActing(true);
    try {
      await apiFetch(`/api/fin/subjects/${delTarget.id}`, { method: 'DELETE' });
      toast.success('科目已删除');
      setDelTarget(null);
      list.reload();
    } catch (e) {
      toast.error('删除失败', { description: (e as Error).message });
    } finally {
      setActing(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold text-stone-900">会计科目</h1>
          <p className="text-xs text-stone-500 sm:text-sm">科目字典为账务唯一来源；非末级科目不可直接用于凭证分录；有引用/余额不可删除（可停用）</p>
        </div>
        {canWrite && (
          <Button onClick={openCreate}>
            <Plus className="size-4" />
            新增科目
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Input
          className="sm:max-w-xs"
          placeholder="搜索编码 / 名称"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') list.setKeyword(searchInput);
          }}
        />
        <Button variant="outline" onClick={() => list.setKeyword(searchInput)}>
          <Search className="size-4" />
        </Button>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-32">
            <SelectValue placeholder="全部类别" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">全部类别</SelectItem>
            {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
              <SelectItem key={k} value={k}>
                {v}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-lg border border-stone-200 bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>科目编码</TableHead>
              <TableHead>科目名称</TableHead>
              <TableHead>类别</TableHead>
              <TableHead>上级</TableHead>
              <TableHead>方向</TableHead>
              <TableHead className="text-right">期初余额</TableHead>
              <TableHead>状态</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.loading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={8}>
                    <Skeleton className="h-6 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : list.items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-stone-400">
                  暂无科目。系统已预置常用科目，可在此维护扩展。
                </TableCell>
              </TableRow>
            ) : (
              list.items.map((s) => (
                <TableRow key={s.id} className={s.status === 'disabled' ? 'opacity-50' : ''}>
                  <TableCell className="font-mono text-xs">
                    {s.is_leaf ? s.subject_code : <span className="font-semibold">{s.subject_code}</span>}
                    {!s.is_leaf && (
                      <Badge variant="outline" className="ml-2 border-stone-200 text-stone-400">
                        父级
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">{s.subject_name}</TableCell>
                  <TableCell className="text-sm">{CATEGORY_LABELS[s.category]}</TableCell>
                  <TableCell className="font-mono text-xs text-stone-500">{s.parent_code ?? '—'}</TableCell>
                  <TableCell className="text-sm">{DIRECTION_LABELS[s.direction]}</TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {s.opening_amount ? `${DIRECTION_LABELS[s.opening_direction]} ${formatMoney(s.opening_amount)}` : formatMoney(0)}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={s.status === 'active' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-stone-200 bg-stone-100 text-stone-500'}>
                      {s.status === 'active' ? '启用' : '停用'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      {canWrite && (
                        <>
                          <Button variant="ghost" size="icon" onClick={() => openEdit(s)}>
                            <Pencil className="size-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => toggleStatus(s)}>
                            {s.status === 'active' ? <ToggleLeft className="size-4 text-stone-400" /> : <ToggleRight className="size-4 text-emerald-600" />}
                          </Button>
                          <Button variant="ghost" size="icon" className="text-rose-600" onClick={() => setDelTarget(s)}>
                            <Trash2 className="size-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        <PaginationControls page={list.page} pageSize={list.pageSize} total={list.total} onPageChange={list.setPage} />
      </div>

      {all.some((s) => !s.is_leaf) && (
        <div className="rounded-md border border-stone-200 bg-stone-50 p-3 text-xs text-stone-500">
          父级科目不直接记账，余额自动汇总子级科目发生额（如 2221 应交税费 → 进项/销项）。
        </div>
      )}

      {/* 新增/编辑 */}
      <Dialog open={creating} onOpenChange={(o) => !o && setCreating(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{edit ? `编辑科目 ${edit.subject_code}` : '新增科目'}</DialogTitle>
            <DialogDescription>非末级科目（被挂子级后自动）不可用于凭证分录。</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>科目编码 *</Label>
              <Input value={form.subject_code} disabled={!!edit} placeholder="如 1122" onChange={(e) => patch({ subject_code: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>科目名称 *</Label>
              <Input value={form.subject_name} placeholder="如 应收账款" onChange={(e) => patch({ subject_name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>类别 *</Label>
              <Select value={form.category} onValueChange={(v) => patch({ category: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>余额方向</Label>
              <Select value={form.direction} onValueChange={(v) => patch({ direction: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">借</SelectItem>
                  <SelectItem value="1">贷</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>上级科目（可选）</Label>
              <Input value={form.parent_code} placeholder="挂父级后不再是末级" onChange={(e) => patch({ parent_code: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>排序号</Label>
              <Input type="number" value={form.sort_no} onChange={(e) => patch({ sort_no: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>期初余额</Label>
              <Input type="number" value={form.opening_amount} onChange={(e) => patch({ opening_amount: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>期初方向</Label>
              <Select value={form.opening_direction} onValueChange={(v) => patch({ opening_direction: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">借</SelectItem>
                  <SelectItem value="1">贷</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2 flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.balance_flag} onChange={(e) => patch({ balance_flag: e.target.checked })} />
                参与余额表/试算平衡
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.status === 'active'} onChange={(e) => patch({ status: e.target.checked ? 'active' : 'disabled' })} />
                启用
              </label>
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label>备注</Label>
              <Input value={form.remark} onChange={(e) => patch({ remark: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreating(false)}>
              取消
            </Button>
            <Button disabled={acting || !form.subject_code.trim() || !form.subject_name.trim()} onClick={save}>
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <Dialog open={!!delTarget} onOpenChange={(o) => !o && setDelTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除科目 {delTarget?.subject_code}</DialogTitle>
            <DialogDescription>
              有凭证分录引用、已有子级或已配置期初余额的科目不可删除（可停用）。删除后不可恢复。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDelTarget(null)}>
              取消
            </Button>
            <Button variant="destructive" disabled={acting} onClick={doDelete}>
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}