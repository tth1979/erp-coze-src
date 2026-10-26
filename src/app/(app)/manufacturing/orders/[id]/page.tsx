'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Pencil, Trash2, Loader2, PackageMinus, PackagePlus, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { apiFetch, ApiClientError } from '@/lib/api-client';
import { useAuth } from '@/components/auth/auth-provider';
import type { MaOrderDetail } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ApprovalPanel } from '@/components/purchase/approval-panel';
import { DeleteConfirmDialog } from '@/components/master-data/delete-confirm-dialog';
import { MoEditorDialog } from '@/components/processing/mo-editor-dialog';
import { MA_STATUS_LABELS } from '@/lib/ma-labels';

const TYPE_LABELS: Record<string, string> = {
  cut: '切割',
  slot: '开槽',
  edge: '磨边',
  combine: '组合拼贴',
};

function money(v: number | null | undefined): string {
  return `¥${(v ?? 0).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}`;
}

export default function ManufacturingOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const [data, setData] = useState<MaOrderDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [types, setTypes] = useState<{ code: string; label: string }[]>([]);
  const [editorOpen, setEditorOpen] = useState(false);
  const [execOpen, setExecOpen] = useState<'issue' | 'finish' | null>(null);
  const [delOpen, setDelOpen] = useState(false);
  const [acting, setActing] = useState(false);
  const [issueMap, setIssueMap] = useState<Record<string, string>>({});
  const [finishMap, setFinishMap] = useState<Record<string, string>>({});
  const [whId, setWhId] = useState('');

  async function load() {
    try {
      const d = await apiFetch<MaOrderDetail>(`/api/ma/orders/${id}`);
      setData(d);
    } catch (e) {
      setNotFound(true);
      toast.error(e instanceof ApiClientError ? e.message : '加载失败');
    }
  }

  useEffect(() => {
    load();
    apiFetch<{ data: Record<string, { item_code: string; label: string }[]> }>(
      '/api/dict/lookup?types=processing_type',
    )
      .then((d) =>
        setTypes(
          (d.data?.processing_type ?? []).map((t) => ({ code: t.item_code, label: t.label })),
        ),
      )
      .catch(() => setTypes([]));
    apiFetch<{ items: { id: string }[] }>('/api/inv/warehouses?pageSize=100')
      .then((d) => setWhId(d.items?.[0]?.id ?? ''))
      .catch(() => setWhId(''));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const order = data?.order;
  const items = data?.items ?? [];
  const inputs = useMemo(() => items.filter((i) => i.kind === 'input'), [items]);
  const outputs = useMemo(() => items.filter((i) => i.kind === 'output'), [items]);

  useEffect(() => {
    if (data) {
      const im: Record<string, string> = {};
      inputs.forEach((i) => (im[i.id] = String(i.quantity - i.done_quantity)));
      setIssueMap(im);
      const fm: Record<string, string> = {};
      outputs.forEach((o) => (fm[o.id] = String(o.quantity - o.done_quantity)));
      setFinishMap(fm);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.order?.status, data?.items?.length]);

  if (notFound || !order) {
    return (
      <div className="space-y-4">
        <Button asChild variant="ghost" size="sm">
          <Link href="/manufacturing/orders">
            <ArrowLeft className="mr-1 h-4 w-4" /> 返回加工单列表
          </Link>
        </Button>
        <div className="rounded-md border p-8 text-center text-muted-foreground">
          {notFound ? '加工单不存在' : '加载中...'}
        </div>
      </div>
    );
  }

  const canWrite = can('ma.write');
  const canApprove = can('ma.approve');
  const editable = order.status === 'draft' || order.status === 'rejected';
  const executed = order.status === 'approved' || order.status === 'completed';

  async function act(action: string, body?: object) {
    setActing(true);
    try {
      await apiFetch(`/api/ma/orders/${id}/${action}`, {
        method: 'POST',
        body: body ? JSON.stringify(body) : undefined,
      });
      toast.success('操作成功');
      setExecOpen(null);
      load();
    } catch (e) {
      toast.error(e instanceof ApiClientError ? e.message : '操作失败');
    } finally {
      setActing(false);
    }
  }

  async function handleExec() {
    if (!whId) {
      toast.error('未找到可用仓库');
      return;
    }
    const itemsPayload =
      execOpen === 'issue'
        ? inputs
            .filter((i) => Number(issueMap[i.id]) > 0)
            .map((i) => ({ product_id: i.product_id, quantity: Number(issueMap[i.id]) }))
        : outputs
            .filter((o) => Number(finishMap[o.id]) > 0)
            .map((o) => ({ product_id: o.product_id, quantity: Number(finishMap[o.id]) }));
    if (itemsPayload.length === 0) {
      toast.error('请填写执行数量');
      return;
    }
    await act(execOpen ?? 'issue', { warehouse_id: whId, items: itemsPayload });
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link href="/manufacturing/orders">
            <ArrowLeft className="mr-1 h-4 w-4" /> 返回
          </Link>
        </Button>
        <h1 className="text-xl font-semibold font-mono">{order.doc_no}</h1>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
          {MA_STATUS_LABELS[order.status] ?? order.status}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 rounded-md border p-4 text-sm md:grid-cols-4">
        <div>
          <div className="text-muted-foreground">加工类型</div>
          <div className="font-medium">{TYPE_LABELS[order.processing_type] ?? order.processing_type}</div>
        </div>
        <div>
          <div className="text-muted-foreground">损耗比例</div>
          <div className="font-medium">{((order.loss_ratio ?? 0) * 100).toFixed(0)}%</div>
        </div>
        <div>
          <div className="text-muted-foreground">预估成本</div>
          <div className="font-medium">{money(order.estimate_cost)}</div>
        </div>
        <div>
          <div className="text-muted-foreground">已领料 / 已分摊成本</div>
          <div className="font-medium">
            {money(order.issued_cost ?? 0)} / {money(order.allocated_cost ?? 0)}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground">提交人</div>
          <div className="font-medium">{order.submitted_by ?? '-'}</div>
        </div>
        <div>
          <div className="text-muted-foreground">审批级别</div>
          <div className="font-medium">{order.approval_level ? `第${order.approval_level}级（共${order.approval_level}级）` : '-'}</div>
        </div>
        <div className="col-span-2">
          <div className="text-muted-foreground">备注</div>
          <div className="font-medium">{order.remark ?? '-'}</div>
        </div>
      </div>

      {canWrite && (
        <div className="flex flex-wrap gap-2">
          {editable && (
            <Button variant="outline" onClick={() => setEditorOpen(true)}>
              <Pencil className="mr-1 h-4 w-4" /> 编辑
            </Button>
          )}
          {executed && (
            <>
              <Button variant="outline" onClick={() => setExecOpen('issue')} disabled={acting}>
                <PackageMinus className="mr-1 h-4 w-4" /> 分批领料
              </Button>
              <Button variant="outline" onClick={() => setExecOpen('finish')} disabled={acting}>
                <PackagePlus className="mr-1 h-4 w-4" /> 分批完工
              </Button>
            </>
          )}
          {(order.status === 'draft' || order.status === 'pending' || order.status === 'rejected') && (
            <Button
              variant="ghost"
              onClick={() => act('close')}
              disabled={acting}
            >
              <XCircle className="mr-1 h-4 w-4" /> 关闭
            </Button>
          )}
          {order.status === 'draft' && (
            <Button
              variant="ghost"
              className="text-destructive"
              onClick={() => setDelOpen(true)}
            >
              <Trash2 className="mr-1 h-4 w-4" /> 删除
            </Button>
          )}
        </div>
      )}

      <ApprovalPanel
        docType="manufacture"
        docId={order.id}
        status={order.status}
        steps={order.steps ?? []}
        currentStep={order.current_step}
        approvalLevel={order.approval_level}
        rejectReason={order.reject_reason}
        canWrite={canWrite}
        canApprove={canApprove}
        onChanged={load}
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-md border">
          <div className="border-b px-4 py-2 font-medium">投入（原料）</div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>商品</TableHead>
                <TableHead>编码</TableHead>
                <TableHead>计划</TableHead>
                <TableHead>已领料</TableHead>
                <TableHead>单价</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {inputs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-4 text-center text-muted-foreground">
                    无投入行
                  </TableCell>
                </TableRow>
              ) : (
                inputs.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell>{i.product_name}</TableCell>
                    <TableCell className="font-mono text-xs">{i.sku_code}</TableCell>
                    <TableCell>{i.quantity}</TableCell>
                    <TableCell>{i.done_quantity}</TableCell>
                    <TableCell>{money(i.unit_cost)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        <div className="rounded-md border">
          <div className="border-b px-4 py-2 font-medium">产出（成品）</div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>商品</TableHead>
                <TableHead>编码</TableHead>
                <TableHead>计划</TableHead>
                <TableHead>已完工</TableHead>
                <TableHead>单价</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {outputs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-4 text-center text-muted-foreground">
                    无产出行
                  </TableCell>
                </TableRow>
              ) : (
                outputs.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell>{o.product_name}</TableCell>
                    <TableCell className="font-mono text-xs">{o.sku_code}</TableCell>
                    <TableCell>{o.quantity}</TableCell>
                    <TableCell>{o.done_quantity}</TableCell>
                    <TableCell>{money(o.unit_cost)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <MoEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        id={order.id}
        processingTypes={types}
        initial={{
          processing_type: order.processing_type,
          loss_ratio: order.loss_ratio,
          items: items.map((i) => ({ kind: i.kind, product_id: i.product_id, quantity: i.quantity })),
        }}
        onSaved={load}
      />

      <Dialog open={execOpen !== null} onOpenChange={(v) => !v && setExecOpen(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{execOpen === 'issue' ? '分批领料（扣减原料库存）' : '分批完工（产成品入库）'}</DialogTitle>
            <DialogDescription>
              {execOpen === 'issue'
                ? '按投入行填写本次领料数量，不能超过剩余计划。'
                : '按产出行填写本次完工数量，累计完工受损耗比例约束。'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {(execOpen === 'issue' ? inputs : outputs).map((i) => {
              const val = execOpen === 'issue' ? issueMap[i.id] : finishMap[i.id];
              const setVal = execOpen === 'issue' ? setIssueMap : setFinishMap;
              const max = (i.quantity - i.done_quantity) || 0;
              return (
                <div key={i.id} className="grid grid-cols-[1fr_90px] items-center gap-2">
                  <Label>
                    {i.product_name}
                    <span className="ml-1 text-xs text-muted-foreground">
                      {execOpen === 'issue' ? `剩余 ${max}` : `最大可完工 ${max}`}
                    </span>
                  </Label>
                  <Input
                    type="number"
                    min={0}
                    max={max}
                    value={val ?? ''}
                    onChange={(e) => setVal((m) => ({ ...m, [i.id]: e.target.value }))}
                  />
                </div>
              );
            })}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExecOpen(null)}>
              取消
            </Button>
            <Button onClick={handleExec} disabled={acting}>
              {acting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              确认{execOpen === 'issue' ? '领料' : '完工'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DeleteConfirmDialog
        open={delOpen}
        onOpenChange={setDelOpen}
        endpoint={`/api/ma/orders/${id}`}
        name={order.doc_no}
        onDeleted={() => {
          window.location.href = '/manufacturing/orders';
        }}
      />
    </div>
  );
}