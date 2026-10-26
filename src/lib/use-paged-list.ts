'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { apiFetch, ApiClientError } from '@/lib/api-client';
import type { PagedList } from '@/lib/types';

interface UsePagedListResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  loading: boolean;
  keyword: string;
  setPage: (page: number) => void;
  setKeyword: (keyword: string) => void;
  reload: () => void;
}

/** 分页列表数据加载：keyword 变化回到第一页，page 变化翻页；filters 追加查询参数 */
export function usePagedList<T>(
  endpoint: string,
  pageSize = 10,
  filters?: Record<string, string>,
): UsePagedListResult<T> {
  const [items, setItems] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const filtersKey = JSON.stringify(filters ?? {});

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (keyword.trim()) params.set('keyword', keyword.trim());
    const extra = JSON.parse(filtersKey) as Record<string, string>;
    for (const [key, value] of Object.entries(extra)) {
      if (value) params.set(key, value);
    }
    apiFetch<PagedList<T>>(`${endpoint}?${params.toString()}`)
      .then((data) => {
        if (cancelled) return;
        setItems(data.items);
        setTotal(data.total);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        toast.error(error instanceof ApiClientError ? error.message : '加载失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [endpoint, page, pageSize, keyword, tick, filtersKey]);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  const handleSetKeyword = useCallback((value: string) => {
    setPage(1);
    setKeyword(value);
  }, []);

  return {
    items,
    total,
    page,
    pageSize,
    loading,
    keyword,
    setPage,
    setKeyword: handleSetKeyword,
    reload,
  };
}
