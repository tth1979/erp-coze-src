'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Plus, Trash2, Wand2 } from 'lucide-react';
import { apiFetch, ApiClientError } from '@/lib/api-client';
import type { PriceResolveResult, Product, Quote } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface CustomerOption {
  id: string;
  code: string;
  name: string;
}

interface EditableItem {
  key: number;
  productId: string;
  colorCode: string;
  quantity: string;
  unitPrice: string;
  discountRate: string;
  taxRate: string;
}

interface ColorOption {
  product_id: string;
  color_code: string;
  color_name: string;
  status: string;
}

interface QuoteEditorProps {
  mode: 'create' | 'edit';
  initial?: Quote;
  onSaved: (quote: Quote) => void;
  onCancel?: () => void;
}

function formatMoney(value: number): string {
  return `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** 报价单编辑器：单据头 + 明细行（数量×含税单价×折扣率，金额服务端最终复核） */
export function QuoteEditor({ mode, initial, onSaved, onCancel }: QuoteEditorProps) {
  const [customers, setCustomers] = useState<CustomerOption[] | null>(null);
  const [products, setProducts] = useState<Product[] | null>(null);
  const [customerId, setCustomerId] = useState(initial?.customer_id ?? '');
  const [quoteDate, setQuoteDate] = useState(initial?.quote_date ?? '');
  const [validUntil, setValidUntil] = useState(initial?.valid_until ?? '');
  const [salesman, setSalesman] = useState(initial?.salesman ?? '');
  const [remark, setRemark] = useState(initial?.remark ?? '');
  const [items, setItems] = useState<EditableItem[]>([]);
  const [colorsMap, setColorsMap] = useState<Map<string, ColorOption[]>>(new Map());
  const [submitting, setSubmitting] = useState(false);
  const keyRef = useRef(1);

  useEffect(() => {
    if (mode === 'create' && !quoteDate) {
      setQuoteDate(new Date().toISOString().slice(0, 10));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // 加载客户/商品/色号选项
  useEffect(() => {
    Promise.all([
      apiFetch<{ items: CustomerOption[] }>('/api/md/customers?page=1&pageSize=100'),
      apiFetch<{ items: Product[] }>('/api/md/products?page=1&pageSize=100'),
      apiFetch<{ items: ColorOption[] }>('/api/md/colors'),
    ])
      .then(([c, g, color]) => {
        setCustomers(c.items);
        setProducts(g.items);
        const map = new Map<string, ColorOption[]>();
        for (const item of color.items) {
          if (item.status !== 'active') continue;
          const arr = map.get(item.product_id) ?? [];
          arr.push(item);
          map.set(item.product_id, arr);
        }
        setColorsMap(map);
      })
      .catch((error: unknown) => {
        toast.error(error instanceof ApiClientError ? error.message : '基础资料加载失败');
        setCustomers([]);
        setProducts([]);
      });
  }, []);

  // 编辑模式：初始化明细行
  useEffect(() => {
    if (mode === 'edit' && initial?.items) {
      setItems(
        initial.items.map((item) => ({
          key: keyRef.current++,
          productId: item.product_id,
          colorCode: item.color_code ?? '',
          quantity: String(item.quantity),
          unitPrice: String(item.unit_price),
          discountRate: String(item.discount_rate),
          taxRate: String(item.tax_rate),
        })),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, initial?.id]);

  // 新建模式：默认一行
  useEffect(() => {
    if (mode === 'create' && items.length === 0) {
      setItems([emptyItem()]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  function emptyItem(): EditableItem {
    return { key: keyRef.current++, productId: '', colorCode: '', quantity: '', unitPrice: '', discountRate: '100', taxRate: '13' };
  }

  function addItem() {
    setItems((prev) => [...prev, emptyItem()]);
  }

  function removeItem(key: number) {
    setItems((prev) => prev.filter((item) => item.key !== key));
  }

  function updateItem(key: number, patch: Partial<EditableItem>) {
    setItems((prev) => prev.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  }

  function onSelectProduct(key: number, productId: string) {
    const product = products?.find((p) => p.id === productId);
    const row = items.find((item) => item.key === key);
    const patch: Partial<EditableItem> = { productId, colorCode: '' };
    if (product?.reference_sale_price && (!row || row.unitPrice === '')) {
      patch.unitPrice = product.reference_sale_price;
    }
    updateItem(key, patch);
  }

  /** 试算：调用三档取优 API 回填含税单价 */
  function resolveRowPrice(key: number) {
    const row = items.find((item) => item.key === key);
    if (!customerId) {
      toast.error('请先选择客户');
      return;
    }
    if (!row?.productId) {
      toast.error('请先选择商品');
      return;
    }
    const qty = Number(row.quantity) > 0 ? Number(row.quantity) : 1;
    apiFetch<PriceResolveResult>(
      `/api/sales/price/resolve?customer_id=${customerId}&product_id=${row.productId}&qty=${qty}`,
    )
      .then((result) => {
        updateItem(key, { unitPrice: String(result.unit_price) });
        toast.info(
          result.hit
            ? `命中${result.scope_type === 'customer_sku' ? '客户+SKU 专属价' : result.scope_type === 'customer_level' ? '客户等级价' : '全局默认价'}：${formatMoney(result.unit_price)}`
            : `未配置价格策略，取商品参考售价：${formatMoney(result.unit_price)}`,
        );
      })
      .catch((error: unknown) => {
        toast.error(error instanceof ApiClientError ? error.message : '试算失败');
      });
  }

  const total = items.reduce((sum, item) => {
    const qty = Number(item.quantity);
    const price = Number(item.unitPrice);
    const rate = Number(item.discountRate || '100');
    if (!Number.isFinite(qty) || !Number.isFinite(price) || !Number.isFinite(rate)) return sum;
    return sum + (qty * price * rate) / 100;
  }, 0);

  function validate(): string | null {
    if (!customerId) return '请选择客户';
    if (validUntil && quoteDate && validUntil < quoteDate) return '有效期至不能早于报价日期';
    if (items.length === 0) return '至少需要一行明细';
    const seen = new Set<string>();
    for (const [index, item] of items.entries()) {
      if (!item.productId) return `第 ${index + 1} 行：请选择商品`;
      const qty = Number(item.quantity);
      if (!Number.isFinite(qty) || qty <= 0) return `第 ${index + 1} 行：数量必须大于 0`;
      const price = Number(item.unitPrice);
      if (!Number.isFinite(price) || price < 0) return `第 ${index + 1} 行：单价不能为负`;
      const rate = Number(item.discountRate);
      if (!Number.isFinite(rate) || rate <= 0 || rate > 100) return `第 ${index + 1} 行：折扣率须在 (0,100]`;
      const tax = Number(item.taxRate);
      if (!Number.isFinite(tax) || tax < 0 || tax > 100) return `第 ${index + 1} 行：税率须在 [0,100]`;
      const dupKey = `${item.productId}|${item.colorCode}`;
      if (seen.has(dupKey)) return `第 ${index + 1} 行：同型号同色号重复，请合并为一行`;
      seen.add(dupKey);
    }
    return null;
  }

  async function onSubmit() {
    const message = validate();
    if (message) {
      toast.error(message);
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        customer_id: customerId,
        quote_date: quoteDate || undefined,
        valid_until: validUntil || undefined,
        salesman: salesman.trim() || undefined,
        remark: remark.trim() || undefined,
        items: items.map((item) => ({
          product_id: item.productId,
          color_code: item.colorCode || undefined,
          quantity: Number(item.quantity),
          unit_price: Number(item.unitPrice),
          discount_rate: Number(item.discountRate),
          tax_rate: Number(item.taxRate),
        })),
      };
      const saved =
        mode === 'create'
          ? await apiFetch<Quote>('/api/sales/quotes', { method: 'POST', body: JSON.stringify(payload) })
          : await apiFetch<Quote>(`/api/sales/quotes/${initial!.id}`, {
              method: 'PUT',
              body: JSON.stringify(payload),
            });
      toast.success(mode === 'create' ? '报价单已创建' : '报价单已保存');
      onSaved(saved);
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : '保存失败');
    } finally {
      setSubmitting(false);
    }
  }

  if (customers === null || products === null) {
    return (
      <div className="space-y-3 rounded-lg border border-stone-200 bg-white p-4 sm:p-6">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-9 w-1/3" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 单据头 */}
      <div className="rounded-lg border border-stone-200 bg-white p-4 sm:p-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-2">
            <Label>客户 *</Label>
            <Select value={customerId} onValueChange={setCustomerId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="选择客户" />
              </SelectTrigger>
              <SelectContent>
                {customers.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}（{c.code}）
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="q-date">报价日期 *</Label>
            <Input id="q-date" type="date" value={quoteDate} onChange={(e) => setQuoteDate(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="q-valid">有效期至</Label>
            <Input id="q-valid" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="q-salesman">业务员</Label>
            <Input id="q-salesman" value={salesman} onChange={(e) => setSalesman(e.target.value)} maxLength={64} placeholder="默认取创建人" />
          </div>
        </div>
        <div className="mt-4 space-y-2">
          <Label htmlFor="q-remark">备注</Label>
          <Textarea id="q-remark" value={remark} onChange={(e) => setRemark(e.target.value)} rows={2} maxLength={500} />
        </div>
      </div>

      {/* 明细行 */}
      <div className="rounded-lg border border-stone-200 bg-white p-4 sm:p-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-stone-900">报价明细</h2>
          <Button type="button" variant="outline" size="sm" onClick={addItem}>
            <Plus className="mr-1 h-4 w-4" />
            添加明细
          </Button>
        </div>
        <div className="space-y-3">
          {items.map((item, index) => {
            const product = products.find((p) => p.id === item.productId);
            const colorOptions = item.productId ? (colorsMap.get(item.productId) ?? []) : [];
            const qty = Number(item.quantity);
            const price = Number(item.unitPrice);
            const rate = Number(item.discountRate || '100');
            const lineAmount =
              Number.isFinite(qty) && Number.isFinite(price) && Number.isFinite(rate)
                ? (qty * price * rate) / 100
                : 0;
            return (
              <div key={item.key} className="rounded-md border border-stone-200 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-medium text-stone-500">明细 {index + 1}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive"
                    onClick={() => removeItem(item.key)}
                    disabled={items.length === 1}
                    aria-label="删除明细"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <div className="col-span-2 space-y-1.5">
                    <Label>商品 *</Label>
                    <Select value={item.productId} onValueChange={(v) => onSelectProduct(item.key, v)}>
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
                  <div className="space-y-1.5">
                    <Label>色号</Label>
                    <Select value={item.colorCode || '__default__'} onValueChange={(v) => updateItem(item.key, { colorCode: v === '__default__' ? '' : v })}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="默认色" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__default__">默认色</SelectItem>
                        {colorOptions.map((c) => (
                          <SelectItem key={c.color_code} value={c.color_code}>
                            {c.color_name}（{c.color_code}）
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>数量 *（{product?.unit ?? '单位'}）</Label>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={item.quantity}
                      onChange={(e) => updateItem(item.key, { quantity: e.target.value })}
                      placeholder="0"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>含税单价 *</Label>
                    <div className="flex gap-1">
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={item.unitPrice}
                        onChange={(e) => updateItem(item.key, { unitPrice: e.target.value })}
                        placeholder="0.00"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="h-9 w-9 shrink-0"
                        onClick={() => resolveRowPrice(item.key)}
                        aria-label="试算取价"
                        title="按价格策略试算"
                      >
                        <Wand2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>折扣率（%）</Label>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      step="0.1"
                      value={item.discountRate}
                      onChange={(e) => updateItem(item.key, { discountRate: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>税率（%）</Label>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      step="0.1"
                      value={item.taxRate}
                      onChange={(e) => updateItem(item.key, { taxRate: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>金额（折后）</Label>
                    <div className="flex h-9 items-center rounded-md border border-stone-200 bg-stone-50 px-3 text-sm tabular-nums text-stone-700">
                      {formatMoney(lineAmount)}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-4 flex items-center justify-end gap-3 border-t border-stone-100 pt-3">
          <span className="text-sm text-stone-500">合计金额（折后）</span>
          <span className="text-lg font-bold tabular-nums text-stone-900">{formatMoney(total)}</span>
        </div>
      </div>

      {/* 操作 */}
      <div className="flex justify-end gap-2">
        {onCancel ? (
          <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
            取消
          </Button>
        ) : null}
        <Button type="button" onClick={onSubmit} disabled={submitting}>
          {submitting ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
          {mode === 'create' ? '创建报价单' : '保存报价单'}
        </Button>
      </div>
    </div>
  );
}
