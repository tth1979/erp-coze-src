'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Power, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { apiFetch, ApiClientError } from '@/lib/api-client';
import type { Product } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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

export interface ProductColor {
  id: string;
  product_id: string;
  color_code: string;
  color_name: string;
  status: string;
  remark: string | null;
  stock_quantity: number;
}

interface ProductColorsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: Product | null;
  readonly?: boolean;
}

/** 商品色号档案管理：同一 SKU 下维护多个花色（编码唯一+名称+启停+库存关联量） */
export function ProductColorsDialog({ open, onOpenChange, product, readonly }: ProductColorsDialogProps) {
  const [items, setItems] = useState<ProductColor[]>([]);
  const [loading, setLoading] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    if (!product) return;
    setLoading(true);
    try {
      const res = await apiFetch<{ items: ProductColor[] }>(
        `/api/md/colors?product_id=${encodeURIComponent(product.id)}`,
      );
      setItems(res.items);
    } catch (e) {
      toast.error(e instanceof ApiClientError ? e.message : '加载色号失败');
    } finally {
      setLoading(false);
    }
  }, [product]);

  useEffect(() => {
    if (open) {
      setCode('');
      setName('');
      void reload();
    }
  }, [open, reload]);

  const add = async () => {
    if (!product) return;
    if (!code.trim() || !name.trim()) {
      toast.error('色号编码与名称均必填');
      return;
    }
    setSaving(true);
    try {
      await apiFetch('/api/md/colors', {
        method: 'POST',
        body: JSON.stringify({ product_id: product.id, color_code: code.trim(), color_name: name.trim() }),
      });
      toast.success(`色号 ${code.trim()} 已新增`);
      setCode('');
      setName('');
      await reload();
    } catch (e) {
      toast.error(e instanceof ApiClientError ? e.message : '新增色号失败');
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (c: ProductColor) => {
    try {
      await apiFetch(`/api/md/colors/${c.id}`, {
        method: 'PUT',
        body: JSON.stringify({ status: c.status === 'active' ? 'disabled' : 'active' }),
      });
      await reload();
    } catch (e) {
      toast.error(e instanceof ApiClientError ? e.message : '更新色号失败');
    }
  };

  const remove = async (c: ProductColor) => {
    try {
      await apiFetch(`/api/md/colors/${c.id}`, { method: 'DELETE' });
      toast.success(`色号 ${c.color_code} 已删除`);
      await reload();
    } catch (e) {
      toast.error(e instanceof ApiClientError ? e.message : '删除色号失败');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>色号档案 — {product?.name ?? ''}</DialogTitle>
          <DialogDescription>
            库存最小管理单元 = 型号 + 色号 + 批次 + 仓库。色号编码在商品内唯一；停用后新单据不可再选，历史单据不受影响。
          </DialogDescription>
        </DialogHeader>

        {!readonly && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-stone-200 bg-stone-50 p-3">
            <Input
              className="w-36"
              placeholder="色号编码 如 C01"
              value={code}
              maxLength={32}
              onChange={(e) => setCode(e.target.value)}
            />
            <Input
              className="w-44"
              placeholder="色号名称 如 爵士白"
              value={name}
              maxLength={64}
              onChange={(e) => setName(e.target.value)}
            />
            <Button size="sm" onClick={add} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              新增色号
            </Button>
          </div>
        )}

        <div className="max-h-80 overflow-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">色号编码</TableHead>
                <TableHead>色号名称</TableHead>
                <TableHead className="w-24 text-right">现有库存</TableHead>
                <TableHead className="w-20">状态</TableHead>
                {!readonly && <TableHead className="w-24 text-right">操作</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={5}>
                    <Skeleton className="h-6 w-full" />
                  </TableCell>
                </TableRow>
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                    暂未维护色号；未维护色号的商品按「默认色」管理
                  </TableCell>
                </TableRow>
              ) : (
                items.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-mono text-xs">{c.color_code}</TableCell>
                    <TableCell>{c.color_name}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.stock_quantity}</TableCell>
                    <TableCell>
                      {c.status === 'active' ? (
                        <Badge className="bg-emerald-50 text-emerald-700 hover:bg-emerald-100">可选</Badge>
                      ) : (
                        <Badge variant="secondary">停用</Badge>
                      )}
                    </TableCell>
                    {!readonly && (
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" aria-label="启停" onClick={() => toggle(c)}>
                            <Power className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" aria-label="删除" onClick={() => remove(c)}>
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
        </div>
      </DialogContent>
    </Dialog>
  );
}
