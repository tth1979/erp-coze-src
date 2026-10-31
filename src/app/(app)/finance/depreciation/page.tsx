'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Calculator, History, Play } from 'lucide-react';
import { useAuth } from '@/components/auth/auth-provider';
import { formatMoney } from '@/components/finance/balance-list';
import { PaginationControls } from '@/components/master-data/pagination-controls';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { apiFetch, ApiClientError } from '@/lib/api-client';
import { usePagedList } from '@/lib/use-paged-list';

interface DepreciationRecordRow {
  id: string;
  asset_id: string;
  asset_no: string;
  asset_name: string;
  period: string;
  amount: number;
  voucher_no: string | null;
  created_at: string;
}

interface RunResult {
  period: string;
  processed: number;
  skipped: number;
  total_amount: number;
  items: { asset_id: string; asset_no: string; asset_name: string; amount: number; voucher_no: string | null; status: string }[];
}

function currentPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function DepreciationPage() {
  const { can } = useAuth();
  const canWrite = can('fin.write');
  const [period, setPeriod] = useState(currentPeriod());
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [filterPeriod, setFilterPeriod] = useState('');
  const list = usePagedList<DepreciationRecordRow>('/api/fin/depreciation', 10, { period: filterPeriod });

  const loadSummary = useCallback(async () => {
    // 汇总卡片：在用资产数 / 累计折旧总额（通过资产列表聚合）
    try {
      const res = await apiFetch<{ items: { status: string; accrued: number; net_value: number; original_value: number }[]; total: number }>(
        '/api/fin/fixed-assets?page=1&pageSize=100',
      );
      const inUse = res.items.filter((a) => a.status === 'in_use');
      return {
        inUseCount: inUse.length,
        totalAccrued: Math.round(res.items.reduce((s, a) => s + a.accrued, 0) * 100) / 100,
        totalNet: Math.round(res.items.reduce((s, a) => s + a.net_value, 0) * 100) / 100,
        totalOriginal: Math.round(res.items.reduce((s, a) => s + a.original_value, 0) * 100) / 100,
      };
    } catch {
      return null;
    }
  }, []);

  const [summary, setSummary] = useState<{ inUseCount: number; totalAccrued: number; totalNet: number; totalOriginal: number } | null>(null);

  useEffect(() => {
    void loadSummary().then(setSummary);
  }, [loadSummary]);

  async function handleRun() {
    if (!/^\d{4}-\d{2}$/.test(period)) { toast.error('期间格式应为 YYYY-MM'); return; }
    setRunning(true);
    setRunResult(null);
    try {
      const result = await apiFetch<RunResult>('/api/fin/depreciation/run', {
        method: 'POST',
        body: JSON.stringify({ period }),
      });
      setRunResult(result);
      if (result.processed > 0) {
        toast.success(`计提完成：${result.processed} 项资产，合计 ¥${formatMoney(result.total_amount)}`);
      } else {
        toast.info(`期间 ${period} 无需计提（${result.skipped} 项已提或不满足条件）`);
      }
      list.reload();
      void loadSummary().then(setSummary);
    } catch (e) {
      toast.error(e instanceof ApiClientError ? e.message : '计提失败');
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-stone-900">折旧计提</h1>
        <p className="text-xs text-stone-500 sm:text-sm">
          直线法月度计提 · 生成折旧凭证（借费用科目 / 贷 1602 累计折旧）· 同资产同期间幂等只提一次
        </p>
      </div>

      {/* 汇总卡片 */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-lg border border-stone-200 bg-white p-3.5">
          <p className="text-xs text-stone-500">在用资产</p>
          <p className="mt-1 text-xl font-bold tabular-nums text-stone-900">{summary?.inUseCount ?? '—'}</p>
        </div>
        <div className="rounded-lg border border-stone-200 bg-white p-3.5">
          <p className="text-xs text-stone-500">原值合计</p>
          <p className="mt-1 text-xl font-bold tabular-nums text-stone-900">¥{summary ? formatMoney(summary.totalOriginal) : '—'}</p>
        </div>
        <div className="rounded-lg border border-stone-200 bg-white p-3.5">
          <p className="text-xs text-stone-500">累计折旧</p>
          <p className="mt-1 text-xl font-bold tabular-nums text-amber-700">¥{summary ? formatMoney(summary.totalAccrued) : '—'}</p>
        </div>
        <div className="rounded-lg border border-stone-200 bg-white p-3.5">
          <p className="text-xs text-stone-500">净值合计</p>
          <p className="mt-1 text-xl font-bold tabular-nums text-emerald-700">¥{summary ? formatMoney(summary.totalNet) : '—'}</p>
        </div>
      </div>

      {/* 计提操作 */}
      {canWrite && (
        <div className="flex flex-col gap-2 rounded-lg border border-stone-200 bg-white p-4 sm:flex-row sm:items-end">
          <div className="space-y-1">
            <label className="text-xs font-medium text-stone-500">计提期间（YYYY-MM）</label>
            <Input
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              placeholder="2026-11"
              className="h-9 w-full font-mono sm:w-40"
            />
          </div>
          <Button size="sm" onClick={handleRun} disabled={running}>
            <Play className="mr-1 h-4 w-4" />
            {running ? '计提中…' : '执行月度计提'}
          </Button>
          {runResult && (
            <div className="flex items-center gap-2 text-sm">
              <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
                本次计提 {runResult.processed} 项 · ¥{formatMoney(runResult.total_amount)}
              </Badge>
              {runResult.skipped > 0 && (
                <Badge variant="outline" className="border-stone-200 bg-stone-50 text-stone-500">
                  跳过 {runResult.skipped} 项（已提/提足）
                </Badge>
              )}
            </div>
          )}
        </div>
      )}

      {/* 本次计提明细 */}
      {runResult && runResult.items.length > 0 && (
        <div className="rounded-lg border border-stone-200 bg-white">
          <div className="flex items-center gap-2 border-b border-stone-100 px-4 py-2.5">
            <Calculator className="h-4 w-4 text-stone-400" />
            <span className="text-sm font-medium text-stone-700">本次计提明细（{runResult.period}）</span>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>资产编码</TableHead>
                  <TableHead>名称</TableHead>
                  <TableHead className="text-right">本期折旧</TableHead>
                  <TableHead>凭证号</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runResult.items.map((it) => (
                  <TableRow key={it.asset_id}>
                    <TableCell className="font-mono text-xs">{it.asset_no}</TableCell>
                    <TableCell>{it.asset_name}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(it.amount)}</TableCell>
                    <TableCell className="font-mono text-xs text-stone-500">{it.voucher_no ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* 折旧历史 */}
      <div>
        <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-stone-400" />
            <span className="text-sm font-medium text-stone-700">折旧历史</span>
          </div>
          <Input
            value={filterPeriod}
            onChange={(e) => setFilterPeriod(e.target.value)}
            placeholder="按期间过滤 YYYY-MM（留空全部）"
            className="h-9 w-full font-mono sm:w-56"
          />
        </div>
        {list.loading ? (
          <div className="rounded-lg border border-stone-200 bg-white p-4">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="mt-2 h-8 w-full" />
          </div>
        ) : list.total === 0 ? (
          <div className="rounded-lg border border-stone-200 bg-white p-8 text-center">
            <p className="text-sm text-stone-500">{filterPeriod ? `期间 ${filterPeriod} 暂无折旧记录` : '暂无折旧记录'}</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>期间</TableHead>
                    <TableHead>资产编码</TableHead>
                    <TableHead>资产名称</TableHead>
                    <TableHead className="text-right">折旧额</TableHead>
                    <TableHead>凭证号</TableHead>
                    <TableHead>计提时间</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.items.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-mono text-xs">{row.period}</TableCell>
                      <TableCell className="font-mono text-xs">{row.asset_no}</TableCell>
                      <TableCell>{row.asset_name}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatMoney(row.amount)}</TableCell>
                      <TableCell className="font-mono text-xs text-stone-500">{row.voucher_no ?? '—'}</TableCell>
                      <TableCell className="text-xs text-stone-500">{row.created_at?.slice(0, 10)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <PaginationControls page={list.page} pageSize={list.pageSize} total={list.total} onPageChange={list.setPage} />
          </>
        )}
      </div>
    </div>
  );
}
