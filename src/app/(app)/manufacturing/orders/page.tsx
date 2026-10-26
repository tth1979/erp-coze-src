'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Plus, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/api-client';
import { usePagedList } from '@/lib/use-paged-list';
import { useAuth } from '@/components/auth/auth-provider';
import type { MaOrder } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { MoEditorDialog } from '@/components/processing/mo-editor-dialog';
import { MA_STATUS_LABELS, MA_TYPE_LABELS } from '@/lib/ma-labels';

function money(v: number): string {
  return `¥${(v ?? 0).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}`;
}

export default function ManufacturingOrdersPage() {
  const { can } = useAuth();
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const { items, total, page, setPage, pageSize, keyword, setKeyword, reload } =
    usePagedList<MaOrder>('/api/ma/orders', 10, {
      ...(status ? { status } : {}),
      ...(type ? { processing_type: type } : {}),
    });
  const [types, setTypes] = useState<{ code: string; label: string }[]>([]);
  const [editorOpen, setEditorOpen] = useState(false);

  useEffect(() => {
    apiFetch<{ data: Record<string, { item_code: string; label: string }[]> }>(
      '/api/dict/lookup?types=processing_type',
    )
      .then((d) =>
        setTypes(
          (d.data?.processing_type ?? []).map((t) => ({ code: t.item_code, label: t.label })),
        ),
      )
      .catch(() => setTypes([]));
  }, []);

  const canWrite = can('ma.write');
  const canApprove = can('ma.approve');

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const rows = useMemo(() => items, [items]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">加工单</h1>
          <p className="text-sm text-muted-foreground">
            加工类型/损耗/投入产出配置，审批通过后可分批领料与完工入库。
          </p>
        </div>
        {canWrite && (
          <Button onClick={() => setEditorOpen(true)}>
            <Plus className="mr-1 h-4 w-4" /> 新建加工单
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="w-60"
          placeholder="单号/备注关键字"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
        <Select value={type} onValueChange={(v) => { setType(v); setPage(1); }}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="加工类型" />
          </SelectTrigger>
          <SelectContent>
            {(types.length ? types : Object.keys(MA_TYPE_LABELS).map((k) => ({ code: k, label: MA_TYPE_LABELS[k] }))).map(
              (t) => (
                <SelectItem key={t.code} value={t.code}>
                  {t.label}
                </SelectItem>
              ),
            )}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="状态" />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(MA_STATUS_LABELS).map(([k, v]) => (
              <SelectItem key={k} value={k}>
                {v}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="ml-auto text-sm text-muted-foreground">共 {total} 条</span>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>单号</TableHead>
              <TableHead>加工类型</TableHead>
              <TableHead>损耗</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>预估成本</TableHead>
              <TableHead>已领料成本</TableHead>
              <TableHead>投入/产出</TableHead>
              <TableHead>提交人</TableHead>
              <TableHead>操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">
                  暂无加工单
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-sm">{r.doc_no}</TableCell>
                  <TableCell>{MA_TYPE_LABELS[r.processing_type] ?? r.processing_type}</TableCell>
                  <TableCell>{((r.loss_ratio ?? 0) * 100).toFixed(0)}%</TableCell>
                  <TableCell>{MA_STATUS_LABELS[r.status] ?? r.status}</TableCell>
                  <TableCell>{money(r.estimate_cost)}</TableCell>
                  <TableCell>{money(r.issued_cost ?? 0)}</TableCell>
                  <TableCell>
                    {r.input_count ?? 0} / {r.output_count ?? 0}
                  </TableCell>
                  <TableCell>{r.creator_name ?? '-'}</TableCell>
                  <TableCell>
                    <Button asChild variant="ghost" size="sm">
                      <Link href={`/manufacturing/orders/${r.id}`}>详情</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center gap-2 text-sm">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            上一页
          </Button>
          <span className="text-muted-foreground">
            {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage(page + 1)}
          >
            下一页
          </Button>
        </div>
      )}

      <MoEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        processingTypes={types.length ? types : Object.keys(MA_TYPE_LABELS).map((k) => ({ code: k, label: MA_TYPE_LABELS[k] }))}
        onSaved={reload}
      />
    </div>
  );
}