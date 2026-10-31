'use client';

import { useState } from 'react';
import { Eye, Search } from 'lucide-react';
import { usePagedList } from '@/lib/use-paged-list';
import { PaginationControls } from '@/components/master-data/pagination-controls';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface AuditLogRow {
  id: string;
  user_id: string | null;
  username: string | null;
  display_name: string | null;
  action: string;
  resource: string;
  resource_id: string | null;
  detail: unknown;
  ip: string | null;
  operated_at: string;
}

const ACTION_LABELS: Record<string, string> = {
  login: '登录',
  logout: '登出',
  create: '新增',
  update: '更新',
  delete: '删除',
  submit: '提交审批',
  approve: '审批通过',
  reject: '审批驳回',
  post: '过账',
  void: '红字冲销',
  assign: '分配角色',
  'update-permissions': '权限配置',
  'update-config': '配置变更',
};

const RESOURCE_LABELS: Record<string, string> = {
  auth: '认证',
  role: '角色',
  user: '用户',
  setting: '系统参数',
  'approval-rule': '审批规则',
  'audit-log': '审计日志',
  purchase_request: '采购申请单',
  purchase_order: '采购订单',
  purchase_receipt: '采购入库单',
  purchase_return: '采购退货单',
  sales_order: '销售订单',
  sales_shipment: '销售出库单',
  sales_return: '销售退货单',
  transfer: '调拨单',
  check: '盘点单',
  expense: '费用报销单',
  ma_order: '加工单',
  voucher: '记账凭证',
};

function DetailView({ detail }: { detail: unknown }) {
  if (detail === null || detail === undefined) return <span className="text-muted-foreground">无</span>;
  return (
    <pre className="max-h-72 overflow-auto rounded bg-muted p-3 text-xs">{JSON.stringify(detail, null, 2)}</pre>
  );
}

export default function AuditLogsPage() {
  const [searchInput, setSearchInput] = useState('');
  const [resource, setResource] = useState('');
  const [action, setAction] = useState('');
  const [userFilter, setUserFilter] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const list = usePagedList<AuditLogRow>('/api/system/audit-logs', 15, {
    resource,
    action,
    user: userFilter,
    from,
    to,
  });
  const [detailRow, setDetailRow] = useState<AuditLogRow | null>(null);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">审计日志</h1>
        <p className="text-sm text-muted-foreground">关键操作全量留痕，只读不可删改（数据库触发器强制）</p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs">关键字（资源编号）</Label>
          <div className="flex items-center gap-2">
            <Input
              placeholder="如 PO2026…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') list.setKeyword(searchInput); }}
              className="w-48"
            />
            <Button variant="outline" size="sm" onClick={() => list.setKeyword(searchInput)} aria-label="搜索">
              <Search className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">资源</Label>
          <Input placeholder="如 voucher / role" value={resource} onChange={(e) => setResource(e.target.value)} className="w-36" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">操作</Label>
          <Input placeholder="如 approve" value={action} onChange={(e) => setAction(e.target.value)} className="w-32" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">操作人</Label>
          <Input placeholder="用户名/姓名" value={userFilter} onChange={(e) => setUserFilter(e.target.value)} className="w-32" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">开始日期</Label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">结束日期</Label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
        </div>
      </div>

      {list.loading ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>时间</TableHead>
                  <TableHead>操作人</TableHead>
                  <TableHead>操作</TableHead>
                  <TableHead>资源</TableHead>
                  <TableHead>资源编号</TableHead>
                  <TableHead>IP</TableHead>
                  <TableHead className="w-16">详情</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.items.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="text-sm tabular-nums">{new Date(row.operated_at).toLocaleString('zh-CN')}</TableCell>
                    <TableCell>{row.display_name ?? row.username ?? '-'}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{ACTION_LABELS[row.action] ?? row.action}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{RESOURCE_LABELS[row.resource] ?? row.resource}</Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{row.resource_id ?? '-'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{row.ip ?? '-'}</TableCell>
                    <TableCell>
                      <Button size="sm" variant="ghost" onClick={() => setDetailRow(row)}>
                        <Eye className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {list.items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">暂无日志</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          <PaginationControls page={list.page} pageSize={list.pageSize} total={list.total} onPageChange={list.setPage} />
        </>
      )}

      <Dialog open={!!detailRow} onOpenChange={(open) => !open && setDetailRow(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>日志详情</DialogTitle>
          </DialogHeader>
          {detailRow && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div><span className="text-muted-foreground">时间：</span>{new Date(detailRow.operated_at).toLocaleString('zh-CN')}</div>
                <div><span className="text-muted-foreground">操作人：</span>{detailRow.display_name ?? detailRow.username ?? '-'}</div>
                <div><span className="text-muted-foreground">操作：</span>{ACTION_LABELS[detailRow.action] ?? detailRow.action}</div>
                <div><span className="text-muted-foreground">资源：</span>{RESOURCE_LABELS[detailRow.resource] ?? detailRow.resource}</div>
                <div className="col-span-2"><span className="text-muted-foreground">资源编号：</span><span className="font-mono text-xs">{detailRow.resource_id ?? '-'}</span></div>
                <div><span className="text-muted-foreground">IP：</span>{detailRow.ip ?? '-'}</div>
              </div>
              <div>
                <div className="mb-1 text-muted-foreground">变更详情：</div>
                <DetailView detail={detailRow.detail} />
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
