'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { DatabaseBackup, Download, Eye, Plus, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PaginationControls } from '@/components/master-data/pagination-controls';
import { apiFetch } from '@/lib/api-client';
import { usePagedList } from '@/lib/use-paged-list';

interface TableStat { rows: number; sha256: string }

interface BackupRow {
  id: string;
  backup_no: string;
  backup_time: string;
  backup_type: 'full' | 'partial';
  scope: string[];
  status: string;
  operator_name: string | null;
  note: string | null;
  table_stats: Record<string, TableStat>;
  total_rows: number;
  size_bytes: number;
}

interface BackupDetail extends BackupRow {
  restore_guide: string[];
}

const SCOPE_LABELS: Record<string, string> = {
  md: '基础资料', po: '采购', so: '销售', inv: '库存', fin: '财务',
  tax: '税务', ma: '加工', sys: '系统', dict: '字典',
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export default function BackupsPage() {
  const [typeFilter, setTypeFilter] = useState('');
  const [scopeGroups, setScopeGroups] = useState<string[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [backupType, setBackupType] = useState<'full' | 'partial'>('full');
  const [partialScope, setPartialScope] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [viewing, setViewing] = useState<BackupDetail | null>(null);

  const { items, total, page, pageSize, setPage, setKeyword, reload, loading } = usePagedList<BackupRow>(
    '/api/system/backups',
    10,
    { backup_type: typeFilter },
  );

  useEffect(() => {
    apiFetch<{ scope_groups: string[] }>('/api/system/backups?pageSize=1')
      .then((d) => setScopeGroups(d.scope_groups))
      .catch(() => undefined);
  }, []);

  const toggleScope = (g: string, checked: boolean) => {
    setPartialScope((prev) => (checked ? [...new Set([...prev, g])] : prev.filter((x) => x !== g)));
  };

  const create = useCallback(async () => {
    setSaving(true);
    try {
      const data = await apiFetch<BackupRow>('/api/system/backups', {
        method: 'POST',
        body: JSON.stringify({
          backup_type: backupType,
          scope: backupType === 'partial' ? partialScope : undefined,
          note: note || null,
        }),
      });
      toast.success(`备份完成：${data.backup_no}，共 ${data.total_rows} 行（${formatSize(data.size_bytes)}）`);
      setCreateOpen(false);
      setNote('');
      setPartialScope([]);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '备份失败');
    } finally {
      setSaving(false);
    }
  }, [backupType, partialScope, note, reload]);

  const openDetail = useCallback(async (id: string) => {
    try {
      setViewing(await apiFetch<BackupDetail>(`/api/system/backups/${id}`));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '加载详情失败');
    }
  }, []);

  const download = useCallback(async (row: BackupRow) => {
    try {
      const res = await fetch(`/api/system/backups/${row.id}/export`);
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(data?.message ?? '导出失败');
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${row.backup_no}.json`;
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
          <h1 className="text-2xl font-bold tracking-tight">系统备份</h1>
          <p className="text-sm text-muted-foreground">
            核心业务表一致性快照（真实数据 + sha256 校验）；恢复为运维操作，见详情页指引
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />触发备份
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><DatabaseBackup className="h-5 w-5" />备份历史</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Input placeholder="搜索备份号/备注/操作人" className="w-64" onChange={(e) => setKeyword(e.target.value)} />
            <Select value={typeFilter || 'all'} onValueChange={(v) => { setTypeFilter(v === 'all' ? '' : v); setPage(1); }}>
              <SelectTrigger className="w-32"><SelectValue placeholder="类型" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部类型</SelectItem>
                <SelectItem value="full">全量</SelectItem>
                <SelectItem value="partial">按需</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>备份号</TableHead>
                  <TableHead>时间</TableHead>
                  <TableHead>类型</TableHead>
                  <TableHead>范围</TableHead>
                  <TableHead className="text-right">总行数</TableHead>
                  <TableHead className="text-right">大小</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>操作人</TableHead>
                  <TableHead className="w-24">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground">加载中…</TableCell></TableRow>
                ) : items.length === 0 ? (
                  <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground">暂无备份记录</TableCell></TableRow>
                ) : items.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono">{row.backup_no}</TableCell>
                    <TableCell className="whitespace-nowrap">{new Date(row.backup_time).toLocaleString('zh-CN')}</TableCell>
                    <TableCell>{row.backup_type === 'full' ? <Badge>全量</Badge> : <Badge variant="secondary">按需</Badge>}</TableCell>
                    <TableCell className="max-w-48 truncate">{row.scope.map((g) => SCOPE_LABELS[g] ?? g).join('/')}</TableCell>
                    <TableCell className="text-right">{row.total_rows.toLocaleString()}</TableCell>
                    <TableCell className="text-right">{formatSize(row.size_bytes)}</TableCell>
                    <TableCell>{row.status === 'success' ? <Badge className="bg-emerald-600">成功</Badge> : <Badge variant="destructive">失败</Badge>}</TableCell>
                    <TableCell>{row.operator_name ?? '—'}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openDetail(row.id)}><Eye className="h-4 w-4" /></Button>
                        {row.status === 'success' && (
                          <Button variant="ghost" size="sm" onClick={() => download(row)}><Download className="h-4 w-4" /></Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <PaginationControls page={page} pageSize={pageSize} total={total} onPageChange={setPage} />
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>触发备份</DialogTitle>
            <DialogDescription>快照将真实抽取所选范围的全部业务数据并落库，支持下载导出</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>备份类型</Label>
              <Select value={backupType} onValueChange={(v) => setBackupType(v as 'full' | 'partial')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="full">全量备份（全部业务表）</SelectItem>
                  <SelectItem value="partial">按需备份（选择模块分组）</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {backupType === 'partial' && (
              <div className="space-y-2">
                <Label>备份范围</Label>
                <div className="grid grid-cols-3 gap-2 rounded-md border p-3">
                  {scopeGroups.map((g) => (
                    <label key={g} className="flex items-center gap-2 text-sm">
                      <Checkbox checked={partialScope.includes(g)} onCheckedChange={(c) => toggleScope(g, c === true)} />
                      {SCOPE_LABELS[g] ?? g}
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div className="space-y-2">
              <Label>备注</Label>
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="备份用途说明（可选）" rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>取消</Button>
            <Button onClick={create} disabled={saving || (backupType === 'partial' && partialScope.length === 0)}>
              {saving ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : null}开始备份
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!viewing} onOpenChange={(open) => !open && setViewing(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>备份详情 {viewing?.backup_no}</DialogTitle>
            <DialogDescription>{viewing && new Date(viewing.backup_time).toLocaleString('zh-CN')}</DialogDescription>
          </DialogHeader>
          {viewing && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Badge>{viewing.backup_type === 'full' ? '全量' : '按需'}</Badge>
                <Badge variant="outline">{viewing.total_rows.toLocaleString()} 行</Badge>
                <Badge variant="outline">{formatSize(viewing.size_bytes)}</Badge>
                {viewing.status === 'success' ? <Badge className="bg-emerald-600">成功</Badge> : <Badge variant="destructive">失败</Badge>}
              </div>
              <div className="max-h-64 overflow-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>表</TableHead><TableHead className="text-right">行数</TableHead><TableHead>sha256</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {Object.entries(viewing.table_stats).map(([table, stat]) => (
                      <TableRow key={table}>
                        <TableCell className="font-mono text-xs">{table}</TableCell>
                        <TableCell className="text-right">{stat.rows.toLocaleString()}</TableCell>
                        <TableCell className="font-mono text-xs">{stat.sha256.slice(0, 16)}…</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="space-y-1">
                <Label className="text-sm font-semibold">恢复指引（运维操作，系统不自动覆盖数据）</Label>
                <ol className="list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
                  {viewing.restore_guide.map((line, i) => <li key={i}>{line.replace(/^\d+\.\s*/, '')}</li>)}
                </ol>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
