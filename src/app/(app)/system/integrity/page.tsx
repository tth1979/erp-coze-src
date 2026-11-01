'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  ShieldCheck, Play, RefreshCw, Download, CheckCircle2, AlertTriangle, XCircle, Eye,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PaginationControls } from '@/components/master-data/pagination-controls';
import { apiFetch } from '@/lib/api-client';
import { usePagedList } from '@/lib/use-paged-list';

interface CheckRow {
  id: string;
  run_id: string;
  check_group: string;
  check_key: string;
  check_name: string;
  result: 'pass' | 'fail' | 'warn';
  severity: 'fail' | 'warn';
  failure_type: string | null;
  detail: Record<string, unknown>;
  created_at: string;
}

interface RunSummary {
  run_id: string;
  duration_ms: number;
  summary: { total: number; passed: number; warned: number; failed: number; blocking: boolean };
}

const GROUP_LABELS: Record<string, string> = { manual: '手动', daily: '每日跑批', startup: '启动' };

function resultBadge(result: string) {
  if (result === 'pass') return <Badge className="bg-emerald-600">通过</Badge>;
  if (result === 'warn') return <Badge className="bg-amber-500">警告</Badge>;
  return <Badge variant="destructive">失败</Badge>;
}

export default function IntegrityPage() {
  const [resultFilter, setResultFilter] = useState('');
  const [keyFilter, setKeyFilter] = useState('');
  const [catalog, setCatalog] = useState<Array<{ key: string; name: string }>>([]);
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState<RunSummary | null>(null);
  const [viewing, setViewing] = useState<CheckRow | null>(null);

  const { items, total, page, pageSize, setPage, setKeyword, reload, loading } = usePagedList<CheckRow>(
    '/api/system/integrity/checks',
    10,
    { result: resultFilter, check_key: keyFilter },
  );

  useEffect(() => {
    apiFetch<{ catalog: Array<{ key: string; name: string }> }>('/api/system/integrity/checks?pageSize=1')
      .then((d) => setCatalog(d.catalog))
      .catch(() => undefined);
  }, []);

  const runChecks = useCallback(async () => {
    setRunning(true);
    try {
      const data = await apiFetch<RunSummary>('/api/system/integrity/run', {
        method: 'POST',
        body: JSON.stringify({ group: 'manual' }),
      });
      setLastRun(data);
      if (data.summary.failed > 0) toast.error(`校验完成：${data.summary.failed} 项失败（fail 级将阻断期末结账）`);
      else if (data.summary.warned > 0) toast.warning(`校验完成：${data.summary.warned} 项警告`);
      else toast.success(`校验完成：全部 ${data.summary.total} 项断言通过`);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '校验失败');
    } finally {
      setRunning(false);
    }
  }, [reload]);

  const exportCsv = useCallback(async () => {
    try {
      const res = await fetch('/api/system/integrity/export');
      if (!res.ok) throw new Error('导出失败');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'integrity-checks.csv';
      link.click();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '导出失败');
    }
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">数据一致性校验</h1>
          <p className="text-sm text-muted-foreground">
            数量四态 / 批次结存 / 台账守恒 / 单号唯一 / 货值勾稽 / 凭证平衡 / 应收应付 七项断言；fail 级断言阻断期末结账
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportCsv}>
            <Download className="mr-2 h-4 w-4" />导出
          </Button>
          <Button onClick={runChecks} disabled={running}>
            {running ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
            一键校验
          </Button>
        </div>
      </div>

      {lastRun && (
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>断言总数</CardDescription>
              <CardTitle className="text-2xl">{lastRun.summary.total}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />通过</CardDescription>
              <CardTitle className="text-2xl text-emerald-600">{lastRun.summary.passed}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5 text-amber-500" />警告</CardDescription>
              <CardTitle className="text-2xl text-amber-500">{lastRun.summary.warned}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-1"><XCircle className="h-3.5 w-3.5 text-destructive" />失败{lastRun.summary.blocking ? '（阻断结账）' : ''}</CardDescription>
              <CardTitle className="text-2xl text-destructive">{lastRun.summary.failed}</CardTitle>
            </CardHeader>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5" />断言历史</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Input placeholder="搜索断言名称/失败类型" className="w-64" onChange={(e) => setKeyword(e.target.value)} />
            <Select value={resultFilter || 'all'} onValueChange={(v) => { setResultFilter(v === 'all' ? '' : v); setPage(1); }}>
              <SelectTrigger className="w-32"><SelectValue placeholder="结果" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部结果</SelectItem>
                <SelectItem value="pass">通过</SelectItem>
                <SelectItem value="warn">警告</SelectItem>
                <SelectItem value="fail">失败</SelectItem>
              </SelectContent>
            </Select>
            <Select value={keyFilter || 'all'} onValueChange={(v) => { setKeyFilter(v === 'all' ? '' : v); setPage(1); }}>
              <SelectTrigger className="w-48"><SelectValue placeholder="断言项" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部断言</SelectItem>
                {catalog.map((c) => <SelectItem key={c.key} value={c.key}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>时间</TableHead>
                  <TableHead>触发</TableHead>
                  <TableHead>断言项</TableHead>
                  <TableHead>结果</TableHead>
                  <TableHead>严重级别</TableHead>
                  <TableHead>失败类型</TableHead>
                  <TableHead className="w-16">详情</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">加载中…</TableCell></TableRow>
                ) : items.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">暂无校验记录，点击右上角「一键校验」发起</TableCell></TableRow>
                ) : items.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-nowrap">{new Date(row.created_at).toLocaleString('zh-CN')}</TableCell>
                    <TableCell>{GROUP_LABELS[row.check_group] ?? row.check_group}</TableCell>
                    <TableCell>{row.check_name}</TableCell>
                    <TableCell>{resultBadge(row.result)}</TableCell>
                    <TableCell>{row.severity === 'fail' ? <Badge variant="outline">fail</Badge> : <Badge variant="secondary">warn</Badge>}</TableCell>
                    <TableCell className="font-mono text-xs">{row.failure_type ?? '—'}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" onClick={() => setViewing(row)}><Eye className="h-4 w-4" /></Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <PaginationControls page={page} pageSize={pageSize} total={total} onPageChange={setPage} />
        </CardContent>
      </Card>

      <Dialog open={!!viewing} onOpenChange={(open) => !open && setViewing(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{viewing?.check_name}</DialogTitle>
            <DialogDescription>
              {viewing && new Date(viewing.created_at).toLocaleString('zh-CN')} · run {viewing?.run_id.slice(0, 8)}
            </DialogDescription>
          </DialogHeader>
          {viewing && (
            <div className="space-y-3">
              <div className="flex gap-2">{resultBadge(viewing.result)}<Badge variant="outline">{viewing.severity}</Badge>{viewing.failure_type && <Badge variant="secondary">{viewing.failure_type}</Badge>}</div>
              <pre className="max-h-96 overflow-auto rounded-md bg-muted p-4 text-xs">{JSON.stringify(viewing.detail, null, 2)}</pre>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
