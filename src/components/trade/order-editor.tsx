'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { apiFetch, ApiClientError } from '@/lib/api-client';
import type { Product, PurchaseOrder, QuoteResult, SalesOrder, TradeOrder, TradeOrderItem } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { WarehouseSelect } from '@/components/inventory/warehouse-select';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/** 客户等级中文标签（与 md_customers.level 枚举对应） */
const CUSTOMER_LEVEL_LABELS: Record<string, string> = {
  normal: '普通客户',
  vip: 'VIP 客户',
  strategic: '战略客户',
};

/** 交易对象选项（供应商或客户，两者结构一致） */
interface PartyOption {
  id: string;
  code: string;
  name: string;
}

interface EditableItem {
  key: number;
  productId: string;
  quantity: string;
  unitPrice: string;
}

export type TradeKind = 'purchase' | 'sales';

interface TradeKindConfig {
  /** 交易对象称谓与接口 */
  partyLabel: string;
  partyListEndpoint: string;
  /** 订单接口基础路径 */
  ordersEndpoint: string;
  /** initial 中交易对象 ID 字段名 */
  partyIdField: 'supplier_id' | 'customer_id';
  /** 选中商品时带入的参考价字段 */
  prefillPriceField: 'reference_purchase_price' | 'reference_sale_price';
  /** 单据中文名（toast/按钮文案） */
  docName: string;
}

const KIND_CONFIG: Record<TradeKind, TradeKindConfig> = {
  purchase: {
    partyLabel: '供应商',
    partyListEndpoint: '/api/md/suppliers?page=1&pageSize=100',
    ordersEndpoint: '/api/po/orders',
    partyIdField: 'supplier_id',
    prefillPriceField: 'reference_purchase_price',
    docName: '采购订单',
  },
  sales: {
    partyLabel: '客户',
    partyListEndpoint: '/api/md/customers?page=1&pageSize=100',
    ordersEndpoint: '/api/so/orders',
    partyIdField: 'customer_id',
    prefillPriceField: 'reference_sale_price',
    docName: '销售订单',
  },
};

interface OrderEditorProps {
  kind: TradeKind;
  mode: 'create' | 'edit';
  /** 编辑模式下的现有订单（含 items） */
  initial?: TradeOrder;
  onSaved: (order: TradeOrder) => void;
  onCancel?: () => void;
}

function formatMoney(value: number): string {
  return `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function readPartyId(order: TradeOrder, field: 'supplier_id' | 'customer_id'): string {
  return field === 'supplier_id' ? (order as PurchaseOrder).supplier_id : (order as SalesOrder).customer_id;
}

/** 购销订单编辑器（采购/销售共用）：单据头 + 明细行（数量×单价，金额服务端最终复核） */
export function OrderEditor({ kind, mode, initial, onSaved, onCancel }: OrderEditorProps) {
  const cfg = KIND_CONFIG[kind];
  const [parties, setParties] = useState<PartyOption[] | null>(null);
  const [products, setProducts] = useState<Product[] | null>(null);
  const [partyId, setPartyId] = useState(initial ? readPartyId(initial, cfg.partyIdField) : '');
  const [orderDate, setOrderDate] = useState(initial?.order_date ?? '');
  const [remark, setRemark] = useState(initial?.remark ?? '');
  const [warehouseId, setWarehouseId] = useState(initial?.warehouse_id ?? '');
  const [items, setItems] = useState<EditableItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const keyRef = useRef(1);

  // 新建模式默认今天（客户端挂载后设置，避免 hydration 差异）
  useEffect(() => {
    if (mode === 'create' && !orderDate) {
      setOrderDate(new Date().toISOString().slice(0, 10));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // 加载交易对象与商品选项
  useEffect(() => {
    Promise.all([
      apiFetch<{ items: PartyOption[] }>(cfg.partyListEndpoint),
      apiFetch<{ items: Product[] }>('/api/md/products?page=1&pageSize=100'),
    ])
      .then(([p, g]) => {
        setParties(p.items);
        setProducts(g.items);
      })
      .catch((error: unknown) => {
        toast.error(error instanceof ApiClientError ? error.message : '基础资料加载失败');
        setParties([]);
        setProducts([]);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  // 编辑模式：用订单明细初始化行
  useEffect(() => {
    if (mode === 'edit' && initial?.items) {
      setItems(
        initial.items.map((item: TradeOrderItem) => ({
          key: keyRef.current++,
          productId: item.product_id,
          quantity: String(item.quantity),
          unitPrice: String(item.unit_price),
        })),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, initial?.id]);

  // 新建模式：默认给一行空明细
  useEffect(() => {
    if (mode === 'create' && items.length === 0) {
      setItems([{ key: keyRef.current++, productId: '', quantity: '', unitPrice: '' }]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  function addItem() {
    setItems((prev) => [...prev, { key: keyRef.current++, productId: '', quantity: '', unitPrice: '' }]);
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
    const patch: Partial<EditableItem> = { productId };
    // 单价为空时带入参考价
    const referencePrice = product?.[cfg.prefillPriceField];
    if (referencePrice && (!row || row.unitPrice === '')) {
      patch.unitPrice = referencePrice;
    }
    updateItem(key, patch);
    // 销售模式且已选客户：按客户等级报价覆盖预填（价格策略雏形）
    if (kind === 'sales' && partyId && (!row || row.unitPrice === '')) {
      apiFetch<QuoteResult>(`/api/so/quote?customer_id=${partyId}&product_id=${productId}`)
        .then((quote) => {
          updateItem(key, { unitPrice: String(quote.price) });
          if (quote.discount < 1) {
            toast.info(`已按${CUSTOMER_LEVEL_LABELS[quote.customer_level] ?? '客户等级'}折扣 ${(quote.discount * 100).toFixed(0)}% 报价`);
          }
        })
        .catch(() => {
          // 报价失败时保留商品参考价
        });
    }
  }

  const total = items.reduce((sum, item) => {
    const qty = Number(item.quantity);
    const price = Number(item.unitPrice);
    if (!Number.isFinite(qty) || !Number.isFinite(price)) return sum;
    return sum + qty * price;
  }, 0);

  function validate(): string | null {
    if (!partyId) return `请选择${cfg.partyLabel}`;
    if (items.length === 0) return '至少需要一行明细';
    for (const [index, item] of items.entries()) {
      if (!item.productId) return `第 ${index + 1} 行：请选择商品`;
      const qty = Number(item.quantity);
      if (!Number.isFinite(qty) || qty <= 0) return `第 ${index + 1} 行：数量必须大于 0`;
      const price = Number(item.unitPrice);
      if (!Number.isFinite(price) || price < 0) return `第 ${index + 1} 行：单价不能为负`;
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
      const payload: Record<string, unknown> = {
        order_date: orderDate || undefined,
        remark: remark.trim() || undefined,
        warehouse_id: warehouseId || undefined,
        items: items.map((item) => ({
          product_id: item.productId,
          quantity: Number(item.quantity),
          unit_price: Number(item.unitPrice),
        })),
      };
      payload[cfg.partyIdField] = partyId;
      const saved =
        mode === 'create'
          ? await apiFetch<TradeOrder>(cfg.ordersEndpoint, { method: 'POST', body: JSON.stringify(payload) })
          : await apiFetch<TradeOrder>(`${cfg.ordersEndpoint}/${initial!.id}`, {
              method: 'PUT',
              body: JSON.stringify(payload),
            });
      toast.success(mode === 'create' ? `${cfg.docName}已创建` : `${cfg.docName}已保存`);
      onSaved(saved);
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : '保存失败');
    } finally {
      setSubmitting(false);
    }
  }

  if (parties === null || products === null) {
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
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>{cfg.partyLabel} *</Label>
            <Select value={partyId || undefined} onValueChange={setPartyId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={`选择${cfg.partyLabel}`} />
              </SelectTrigger>
              <SelectContent>
                {parties.map((party) => (
                  <SelectItem key={party.id} value={party.id}>
                    {party.code} · {party.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>下单日期 *</Label>
            <Input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>{kind === 'purchase' ? '收货仓库' : '发货仓库'}</Label>
            <WarehouseSelect
              value={warehouseId}
              onChange={setWarehouseId}
              placeholder="默认仓库"
              allowEmpty
              emptyLabel="默认仓库"
            />
          </div>
          <div className="space-y-1.5">
            <Label>备注</Label>
            <Textarea
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              placeholder={kind === 'purchase' ? '交货时间、账期等补充说明' : '送货地址、开票要求等补充说明'}
              rows={2}
            />
          </div>
        </div>
      </div>

      {/* 明细行 */}
      <div className="rounded-lg border border-stone-200 bg-white p-4 sm:p-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-stone-900">商品明细</h2>
          <Button type="button" variant="outline" size="sm" onClick={addItem}>
            <Plus className="mr-1 h-4 w-4" />
            添加一行
          </Button>
        </div>
        <div className="space-y-2.5">
          {items.map((item, index) => {
            const qty = Number(item.quantity);
            const price = Number(item.unitPrice);
            const amount =
              Number.isFinite(qty) && Number.isFinite(price) && item.quantity !== '' && item.unitPrice !== ''
                ? qty * price
                : null;
            return (
              <div
                key={item.key}
                className="grid grid-cols-2 items-end gap-2 rounded-md border border-stone-200 p-3 md:grid-cols-[1fr_110px_130px_110px_36px] md:border-0 md:p-0"
              >
                <div className="col-span-2 space-y-1 md:col-span-1">
                  <Label className="text-xs text-stone-500">商品 {index + 1}</Label>
                  <Select
                    value={item.productId || undefined}
                    onValueChange={(value) => onSelectProduct(item.key, value)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="选择商品" />
                    </SelectTrigger>
                    <SelectContent>
                      {products.map((product) => (
                        <SelectItem key={product.id} value={product.id}>
                          {product.sku_code} · {product.name}
                          {product.spec ? ` · ${product.spec}` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-stone-500">数量</Label>
                  <Input
                    type="number"
                    min="0"
                    step="any"
                    value={item.quantity}
                    onChange={(e) => updateItem(item.key, { quantity: e.target.value })}
                    placeholder="0"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-stone-500">单价</Label>
                  <Input
                    type="number"
                    min="0"
                    step="any"
                    value={item.unitPrice}
                    onChange={(e) => updateItem(item.key, { unitPrice: e.target.value })}
                    placeholder="0.00"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-stone-500">金额</Label>
                  <div className="flex h-9 items-center text-sm font-medium tabular-nums text-stone-800">
                    {amount === null ? '—' : formatMoney(amount)}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 text-stone-400 hover:text-destructive"
                  onClick={() => removeItem(item.key)}
                  disabled={items.length <= 1}
                  aria-label="删除明细行"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            );
          })}
        </div>
        <div className="mt-4 flex items-center justify-between border-t border-stone-100 pt-3">
          <span className="text-xs text-stone-500 sm:text-sm">合计金额（提交后由服务端复核）</span>
          <span className="text-base font-bold tabular-nums text-stone-900 sm:text-lg">
            {formatMoney(Math.round(total * 100) / 100)}
          </span>
        </div>
      </div>

      {/* 操作 */}
      <div className="flex justify-end gap-2">
        {onCancel ? (
          <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
            取消
          </Button>
        ) : null}
        <Button type="button" onClick={() => void onSubmit()} disabled={submitting}>
          {submitting ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
          {mode === 'create' ? `创建${cfg.docName}（草稿）` : '保存修改'}
        </Button>
      </div>
    </div>
  );
}
