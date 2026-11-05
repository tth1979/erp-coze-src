'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Calculator, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { apiFetch, ApiClientError } from '@/lib/api-client';
import { useAuth } from '@/components/auth/auth-provider';
import { PaginationControls } from '@/components/master-data/pagination-controls';
import { DeleteConfirmDialog } from '@/components/master-data/delete-confirm-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
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
import type { Customer, PriceResolveResult, PriceStrategy, Product } from '@/lib/types';

function formatMoney(value: number): string {
  return `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const SCOPE_LABELS: Record<string, string> = {
  customer_sku: '客户+SKU 专属',
  customer_level: '客户等级',
  global: '全局默认',
};

const LEVEL_LABELS: Record<string, string> = {
  normal: '普通客户',
  vip: 'VIP 客户',
  strategic: '战略客户',
};

interface TierForm {
  key: number;
  unit: string;
  minQty: string;
  unitPrice: string;
}

interface StrategyForm {
  scope_type: 'customer_sku' | 'customer_level' | 'global';
  customer_id: string;
  customer_level: string;
  product_id: string;
  effective_from: string;
  effective_to: string;
  status: string;
  remark: string;
  tiers: TierForm[];
}

let tierKey = 1;
const EMPTY_FORM: StrategyForm = {
  scope_type: 'customer_sku',
  customer_id: '',
  customer_level: 'normal',
  product_id: '',
  effective_from: '',
  effective_to: '',
  status: 'active',
  remark: '',
  tiers: [{ key: tierKey++, unit: '片', minQty: '1', unitPrice: '' }],
};

export default function PriceStrategiesPage() {
  const { can } = useAuth();
  const canWrite = can('so.write');
  const [scopeType, setScopeType] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const list = usePagedList<PriceStrategy>('/api/sales/prices', 10, { scope_type: scopeType });
  const [deleteTarget, setDeleteTarget] = useState<PriceStrategy | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<PriceStrategy | null>(null);
  const [form, setForm] = useState<StrategyForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [calcOpen, setCalcOpen] = useState(false);
  const [calcCustomer, setCalcCustomer] = useState('');
  const [calcProduct, setCalcProduct] = useState('');
  const [calcQty, setCalcQty] = useState('1');
  const [calcResult, setCalcResult] = useState<PriceResolveResult | null>(null);
  const [calcLoading, setCalcLoading] = useState(false);

  useEffect(() => {
    Promise.all([
      apiFetch<{ items: Customer[] }>('/api/md/customers?page=1&pageSize=100'),
      apiFetch<{ items: Product[] }>('/api/md/products?page=1&pageSize=100'),
    ])
      .then(([c, p]) => {
        setCustomers(c.items);
        setProducts(p.items);
      })
      .catch(() => undefined);
  }, []);

  function openCreate() {
    setEditing(null);
    setForm({ ...EMPTY_FORM, effective_from: new Date().toISOString().slice(0, 10), tiers: [{ key: tierKey++, unit: '片', minQty: '1', unitPrice: '' }] });
    setFormOpen(true);
  }

  function openEdit(row: PriceStrategy) {
    setEditing(row);
    setForm({
      scope_type: row.scope_type,
      customer_id: row.customer_id ?? '',
      customer_level: row.customer_level ?? 'normal',
      product_id: row.product_id ?? '',
      effective_from: row.effective_from,
      effective_to: row.effective_to ?? '',
      status: row.status,
      remark: row.remark ?? '',
      tiers: row.tiers.length
        ? row.tiers.map((t) => ({ key: tierKey++, unit: t.unit, minQty: String(t.min_qty), unitPrice: String(t.unit_price) }))
        : [{ key: tierKey++, unit: '片', minQty: '1', unitPrice: '' }],
    });
    setFormOpen(true);
  }

  async function onSave() {
    if (form.scope_type === 'customer_sku' && (!form.customer_id || !form.product_id)) {
      toast.error('客户+SKU 专属价须选择客户与商品');
      return;
    }
    if (!form.effective_from) {
      toast.error('请选择生效起始日');
      return;
    }
    if (form.effective_to && form.effective_to < form.effective_from) {
      toast.error('生效截止日不能早于起始日');
      return;
    }
    for (const [i, t] of form.tiers.entries()) {
      const qty = Number(t.minQty);
      const price = Number(t.unitPrice);
      if (!t.unit.trim()) return toast.error(`阶梯 ${i + 1}：单位不能为空`);
      if (!Number.isFinite(qty) || qty <= 0) return toast.error(`阶梯 ${i + 1}：数量须大于 0`);
      if (!Number.isFinite(price) || price < 0) return toast.error(`阶梯 ${i + 1}：单价不能为负`);
    }
    setSaving(true);
    try {
      const payload = {
        scope_type: form.scope_type,
        customer_id: form.scope_type === 'customer_sku' ? form.customer_id : null,
        product_id: form.scope_type === 'customer_sku' ? form.product_id : null,
        customer_level: form.scope_type === 'customer_level' ? form.customer_level : null,
        effective_from: form.effective_from,
        effective_to: form.effective_to || null,
        status: form.status,
        remark: form.remark.trim() || null,
        tiers: form.tiers.map((t) => ({ unit: t.unit.trim(), min_qty: Number(t.minQty), unit_price: Number(t.unitPrice) })),
      };
      if (editing) {
        await apiFetch(`/api/sales/prices/${editing.id}`, { method: 'PUT', body: JSON.stringify(payload) });
        toast.success('价格策略已更新');
      } else {
        await apiFetch('/api/sales/prices', { method: 'POST', body: JSON.stringify(payload) });
        toast.success('价格策略已创建');
      }
      setFormOpen(false);
      list.reload();
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  function onCalc() {
    if (!calcCustomer || !calcProduct) {
      toast.error('请选择客户与商品');
      return;
    }
    setCalcLoading(true);
    setCalcResult(null);
    apiFetch<PriceResolveResult>(
      `/api/sales/price/resolve?customer_id=${calcCustomer}&product_id=${calcProduct}&qty=${Number(calcQty) || 1}`,
    )
      .then(setCalcResult)
      .catch((error: unknown) => toast.error(error instanceof ApiClientError ? error.message : '试算失败'))
      .finally(() => setCalcLoading(false));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold text-stone-900">价格策略</h1>
          <p className="text-xs text-stone-500 sm:text-sm">
            取价优先级：客户+SKU 专属 &gt; 客户等级 &gt; 全局默认；同级取生效期内开始日最新，再按数量命中最低档
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setCalcOpen(true)}>
            <Calculator className="mr-1 h-4 w-4" />
            试算
          </Button>
          {canWrite ? (
            <Button size="sm" onClick={openCreate}>
              <Plus className="mr-1 h-4 w-4" />
              新建策略
            </Button>
          ) : null}
        </div>
      </div>

      {/* 筛选栏 */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') list.setKeyword(searchInput);
          }}
          placeholder="按备注搜索，回车确认"
          className="h-9 w-full sm:w-72"
        />
        <Select value={scopeType || 'all'} onValueChange={(v) => { list.setPage(1); setScopeType(v === 'all' ? '' : v); }}>
          <SelectTrigger className="h-9 w-full sm:w-44">
            <SelectValue placeholder="全部作用对象" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部作用对象</SelectItem>
            {Object.entries(SCOPE_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={() => list.setKeyword(searchInput)} aria-label="搜索">
          <Search className="h-4 w-4 sm:mr-1" />
          <span className="hidden sm:inline">搜索</span>
        </Button>
      </div>

      {list.loading ? (
        <div className="rounded-lg border border-stone-200 bg-white p-4">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="mt-2 h-8 w-full" />
        </div>
      ) : list.total === 0 ? (
        <div className="rounded-lg border border-stone-200 bg-white p-8 text-center">
          <p className="text-sm text-stone-500">{list.keyword || scopeType ? '没有符合条件的价格策略' : '暂无价格策略'}</p>
          {canWrite && !list.keyword && !scopeType ? (
            <Button className="mt-3" size="sm" onClick={openCreate}>
              <Plus className="mr-1 h-4 w-4" />
              新建第一条策略
            </Button>
          ) : null}
        </div>
      ) : (
        <>
          <div className="rounded-lg border border-stone-200 bg-white shadow-sm">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>作用对象</TableHead>
                  <TableHead>目标客户 / 商品</TableHead>
                  <TableHead>生效期</TableHead>
                  <TableHead>阶梯价</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.items.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <Badge variant={row.scope_type === 'customer_sku' ? 'default' : row.scope_type === 'customer_level' ? 'secondary' : 'outline'}>
                        {SCOPE_LABELS[row.scope_type] ?? row.scope_type}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {row.scope_type === 'customer_sku'
                        ? `${row.customer_name ?? '—'} / ${row.product_name ?? '—'}`
                        : row.scope_type === 'customer_level'
                          ? LEVEL_LABELS[row.customer_level ?? ''] ?? row.customer_level
                          : '全部客户（未命中专属/等级时）'}
                    </TableCell>
                    <TableCell className="text-stone-600">
                      {row.effective_from} ~ {row.effective_to ?? '长期'}
                    </TableCell>
                    <TableCell className="text-xs text-stone-600">
                      {row.tiers
                        .slice()
                        .sort((a, b) => a.min_qty - b.min_qty)
                        .map((t) => `≥${t.min_qty}${t.unit}=${formatMoney(t.unit_price)}`)
                        .join('；')}
                    </TableCell>
                    <TableCell>
                      <Badge variant={row.status === 'active' ? 'default' : 'secondary'}>
                        {row.status === 'active' ? '启用' : '停用'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {canWrite ? (
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(row)} aria-label="编辑">
                            <Pencil className="h-4 w-4" />
                          </Button>
                        ) : null}
                        {canWrite ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive"
                            onClick={() => setDeleteTarget(row)}
                            aria-label="删除"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="rounded-lg border border-stone-200 bg-white shadow-sm">
            <PaginationControls page={list.page} pageSize={list.pageSize} total={list.total} onPageChange={list.setPage} />
          </div>
        </>
      )}

      {/* 策略编辑弹窗 */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{editing ? '编辑价格策略' : '新建价格策略'}</DialogTitle>
            <DialogDescription>作用对象三选一；阶梯按数量档取价，取价时命中满足数量的最低档价。</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>作用对象 *</Label>
                <Select value={form.scope_type} onValueChange={(v) => setForm((p) => ({ ...p, scope_type: v as StrategyForm['scope_type'] }))}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(SCOPE_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {form.scope_type === 'customer_sku' ? (
                <>
                  <div className="space-y-2">
                    <Label>客户 *</Label>
                    <Select value={form.customer_id} onValueChange={(v) => setForm((p) => ({ ...p, customer_id: v }))}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="选择客户" />
                      </SelectTrigger>
                      <SelectContent>
                        {customers.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-2 space-y-2">
                    <Label>商品（SKU）*</Label>
                    <Select value={form.product_id} onValueChange={(v) => setForm((p) => ({ ...p, product_id: v }))}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="选择商品" />
                      </SelectTrigger>
                      <SelectContent>
                        {products.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.sku_code} · {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </>
              ) : null}
              {form.scope_type === 'customer_level' ? (
                <div className="space-y-2">
                  <Label>客户等级 *</Label>
                  <Select value={form.customer_level} onValueChange={(v) => setForm((p) => ({ ...p, customer_level: v }))}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(LEVEL_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
              <div className="space-y-2">
                <Label>生效起始日 *</Label>
                <Input type="date" value={form.effective_from} onChange={(e) => setForm((p) => ({ ...p, effective_from: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>生效截止日</Label>
                <Input type="date" value={form.effective_to} onChange={(e) => setForm((p) => ({ ...p, effective_to: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>状态</Label>
                <Select value={form.status} onValueChange={(v) => setForm((p) => ({ ...p, status: v }))}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">启用</SelectItem>
                    <SelectItem value="disabled">停用</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* 阶梯明细 */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>阶梯明细 *（数量 → 单价）</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setForm((p) => ({ ...p, tiers: [...p.tiers, { key: tierKey++, unit: '片', minQty: '1', unitPrice: '' }] }))}
                >
                  <Plus className="mr-1 h-4 w-4" />
                  加一档
                </Button>
              </div>
              {form.tiers.map((tier) => (
                <div key={tier.key} className="flex items-center gap-2">
                  <Input
                    className="w-24"
                    value={tier.unit}
                    onChange={(e) => setForm((p) => ({ ...p, tiers: p.tiers.map((t) => (t.key === tier.key ? { ...t, unit: e.target.value } : t)) }))}
                    placeholder="单位"
                    maxLength={16}
                  />
                  <span className="text-xs text-stone-500">≥</span>
                  <Input
                    type="number"
                    min={0}
                    className="w-28"
                    value={tier.minQty}
                    onChange={(e) => setForm((p) => ({ ...p, tiers: p.tiers.map((t) => (t.key === tier.key ? { ...t, minQty: e.target.value } : t)) }))}
                    placeholder="数量"
                  />
                  <span className="text-xs text-stone-500">单价</span>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    className="w-32"
                    value={tier.unitPrice}
                    onChange={(e) => setForm((p) => ({ ...p, tiers: p.tiers.map((t) => (t.key === tier.key ? { ...t, unitPrice: e.target.value } : t)) }))}
                    placeholder="0.00"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive"
                    disabled={form.tiers.length === 1}
                    onClick={() => setForm((p) => ({ ...p, tiers: p.tiers.filter((t) => t.key !== tier.key) }))}
                    aria-label="删除阶梯"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>

            <div className="space-y-2">
              <Label>备注</Label>
              <Textarea value={form.remark} onChange={(e) => setForm((p) => ({ ...p, remark: e.target.value }))} rows={2} maxLength={500} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)} disabled={saving}>
              取消
            </Button>
            <Button onClick={() => void onSave()} disabled={saving}>
              {saving ? '保存中…' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 试算弹窗 */}
      <Dialog open={calcOpen} onOpenChange={setCalcOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>售价试算</DialogTitle>
            <DialogDescription>按三档优先级（客户+SKU &gt; 客户等级 &gt; 全局）与数量阶梯试算含税单价。</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>客户 *</Label>
              <Select value={calcCustomer} onValueChange={setCalcCustomer}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="选择客户" />
                </SelectTrigger>
                <SelectContent>
                  {customers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>商品 *</Label>
              <Select value={calcProduct} onValueChange={setCalcProduct}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="选择商品" />
                </SelectTrigger>
                <SelectContent>
                  {products.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.sku_code} · {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>数量</Label>
              <Input type="number" min={1} value={calcQty} onChange={(e) => setCalcQty(e.target.value)} />
            </div>
            {calcResult ? (
              <div className="rounded-md border border-stone-200 bg-stone-50 p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-stone-500">试算单价</span>
                  <span className="text-lg font-bold tabular-nums text-stone-900">{formatMoney(calcResult.unit_price)}</span>
                </div>
                <p className="mt-1 text-xs text-stone-500">
                  {calcResult.hit
                    ? `命中：${SCOPE_LABELS[calcResult.scope_type ?? ''] ?? ''}${calcResult.tier ? `（≥${calcResult.tier.min_qty}${calcResult.tier.unit} 档）` : ''}`
                    : '未命中价格策略，取商品参考售价'}
                </p>
                <p className="mt-0.5 text-xs text-stone-400">{calcResult.reason}</p>
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCalcOpen(false)}>
              关闭
            </Button>
            <Button onClick={onCalc} disabled={calcLoading}>
              {calcLoading ? '试算中…' : '试算'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DeleteConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        endpoint={deleteTarget ? `/api/sales/prices/${deleteTarget.id}` : null}
        name={deleteTarget ? `${SCOPE_LABELS[deleteTarget.scope_type] ?? ''} 策略` : ''}
        onDeleted={list.reload}
      />
    </div>
  );
}
