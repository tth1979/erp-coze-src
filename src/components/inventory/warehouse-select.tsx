'use client';

import { useEffect, useState } from 'react';
import { Warehouse } from 'lucide-react';
import { apiFetch } from '@/lib/api-client';
import type { InvWarehouse } from '@/lib/types';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

let cache: InvWarehouse[] | null = null;

/** 加载仓库档案（模块级缓存，页面内多实例共享一次请求） */
export function useWarehouses() {
  const [warehouses, setWarehouses] = useState<InvWarehouse[]>(cache ?? []);
  useEffect(() => {
    let cancelled = false;
    apiFetch<{ items: InvWarehouse[] }>('/api/inv/warehouses')
      .then((data) => {
        cache = data.items;
        if (!cancelled) setWarehouses(data.items);
      })
      .catch(() => {
        /* 权限/网络失败时保持空列表，由表单自行兜底 */
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return warehouses;
}

/** 仓库筛选下拉（含"全部仓库"项，仅列出启用中的仓库 + 当前已选值） */
export function WarehouseFilterSelect({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  const warehouses = useWarehouses();
  return (
    <Select value={value || 'all'} onValueChange={(v) => onChange(v === 'all' ? '' : v)}>
      <SelectTrigger className={className ?? 'h-9 w-full sm:w-40'}>
        <Warehouse className="h-3.5 w-3.5 text-stone-400" />
        <SelectValue placeholder="全部仓库" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">全部仓库</SelectItem>
        {warehouses.map((w) => (
          <SelectItem key={w.id} value={w.id}>
            {w.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** 仓库单选下拉（表单用；仅启用中的仓库；allowEmpty 时提供"清空"项） */
export function WarehouseSelect({
  value,
  onChange,
  placeholder = '选择仓库',
  className,
  allowEmpty = false,
  emptyLabel = '不指定',
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  allowEmpty?: boolean;
  emptyLabel?: string;
}) {
  const warehouses = useWarehouses();
  return (
    <Select
      value={value || (allowEmpty ? '__none__' : '')}
      onValueChange={(v) => onChange(allowEmpty && v === '__none__' ? '' : v)}
    >
      <SelectTrigger className={className ?? 'h-9 w-full'}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {allowEmpty ? <SelectItem value="__none__">{emptyLabel}</SelectItem> : null}
        {warehouses
          .filter((w) => w.is_active || w.id === value)
          .map((w) => (
            <SelectItem key={w.id} value={w.id}>
              {w.name}
            </SelectItem>
          ))}
      </SelectContent>
    </Select>
  );
}
