'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/components/auth/auth-provider';
import { apiFetch, ApiClientError } from '@/lib/api-client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface RuleStep {
  id: string;
  step_no: number;
  approver_role: string;
}

interface Rule {
  id: string;
  doc_type: string;
  doc_type_label: string;
  level: number;
  min_amount: number;
  max_amount: number | null;
  steps: RuleStep[];
}

const ROLE_LABELS: Record<string, string> = { manager: '业务主管', admin: '系统管理员' };

interface EditState {
  id: string;
  docTypeLabel: string;
  level: number;
  min_amount: string;
  max_amount: string;
  steps: string[];
}

export default function ApprovalFlowsPage() {
  const { can } = useAuth();
  const writable = can('sys.write');
  const [rules, setRules] = useState<Rule[]>([]);
  const [docLabels, setDocLabels] = useState<Record<string, string>>({});
  const [docFilter, setDocFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (docFilter) params.set('doc_type', docFilter);
      const data = await apiFetch<{ items: Rule[]; doc_type_labels: Record<string, string> }>(`/api/system/approval-rules?${params}`);
      setRules(data.items);
      setDocLabels(data.doc_type_labels);
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [docFilter]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const docTypes = useMemo(() => Object.keys(docLabels), [docLabels]);

  const grouped = useMemo(() => {
    const map = new Map<string, Rule[]>();
    for (const rule of rules) {
      const arr = map.get(rule.doc_type) ?? [];
      arr.push(rule);
      map.set(rule.doc_type, arr);
    }
    return [...map.entries()];
  }, [rules]);

  const openEdit = (rule: Rule) =>
    setEdit({
      id: rule.id,
      docTypeLabel: rule.doc_type_label,
      level: rule.level,
      min_amount: String(rule.min_amount),
      max_amount: rule.max_amount === null ? '' : String(rule.max_amount),
      steps: rule.steps.length > 0 ? rule.steps.map((s) => s.approver_role) : ['manager'],
    });

  const save = async () => {
    if (!edit) return;
    const minAmount = Number(edit.min_amount);
    if (!Number.isFinite(minAmount) || minAmount < 0) {
      toast.error('金额下限无效');
      return;
    }
    let maxAmount: number | null = null;
    if (edit.max_amount.trim() !== '') {
      maxAmount = Number(edit.max_amount);
      if (!Number.isFinite(maxAmount) || maxAmount <= 0) {
        toast.error('金额上限必须为正数或留空（不限）');
        return;
      }
      if (maxAmount <= minAmount) {
        toast.error('金额上限必须大于下限');
        return;
      }
    }
    if (edit.steps.length === 0) {
      toast.error('至少保留一个审批步骤');
      return;
    }
    setSaving(true);
    try {
      await apiFetch(`/api/system/approval-rules/${edit.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          min_amount: minAmount,
          max_amount: maxAmount,
          steps: edit.steps.map((role, i) => ({ step_no: i + 1, approver_role: role })),
        }),
      });
      toast.success('审批规则已保存（变更已写入审计日志）');
      setEdit(null);
      await reload();
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">审批流配置</h1>
        <p className="text-sm text-muted-foreground">按单据类型查看/配置金额分级档位与每档审批角色序列；变更实时生效并写入审计日志</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Select value={docFilter || 'all'} onValueChange={(v) => setDocFilter(v === 'all' ? '' : v)}>
          <SelectTrigger className="w-52">
            <SelectValue placeholder="全部单据类型" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部单据类型</SelectItem>
            {docTypes.map((t) => (
              <SelectItem key={t} value={t}>{docLabels[t] ?? t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="text-xs text-muted-foreground">越级规则：步骤角色为 manager 时 manager/admin 均可审；步骤角色为 admin 时仅 admin 可审</div>
      </div>

      {loading ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <div className="space-y-6">
          {grouped.map(([docType, docRules]) => (
            <div key={docType} className="space-y-2">
              <h2 className="text-lg font-semibold">{docLabels[docType] ?? docType}</h2>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-20">档位</TableHead>
                      <TableHead>金额区间</TableHead>
                      <TableHead>审批角色序列</TableHead>
                      {writable && <TableHead className="w-20">操作</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {docRules.map((rule) => (
                      <TableRow key={rule.id}>
                        <TableCell>
                          <Badge variant="outline">{rule.level} 级</Badge>
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          {rule.min_amount.toLocaleString('zh-CN')} ~ {rule.max_amount === null ? '不限' : rule.max_amount.toLocaleString('zh-CN')}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-1">
                            {rule.steps.map((step, i) => (
                              <span key={step.id} className="flex items-center gap-1">
                                {i > 0 && <ArrowRight className="h-3 w-3 text-muted-foreground" />}
                                <Badge variant="secondary">{ROLE_LABELS[step.approver_role] ?? step.approver_role}</Badge>
                              </span>
                            ))}
                            {rule.steps.length === 0 && <span className="text-xs text-muted-foreground">未配置</span>}
                          </div>
                        </TableCell>
                        {writable && (
                          <TableCell>
                            <Button size="sm" variant="ghost" onClick={() => openEdit(rule)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          ))}
          {grouped.length === 0 && <p className="py-8 text-center text-muted-foreground">暂无审批规则</p>}
        </div>
      )}

      <Dialog open={!!edit} onOpenChange={(open) => !open && setEdit(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{edit ? `编辑档位 - ${edit.docTypeLabel} · ${edit.level} 级` : '编辑档位'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>金额下限（含）</Label>
                <Input
                  type="number"
                  min={0}
                  value={edit?.min_amount ?? ''}
                  onChange={(e) => setEdit((prev) => (prev ? { ...prev, min_amount: e.target.value } : prev))}
                />
              </div>
              <div className="space-y-2">
                <Label>金额上限（留空不限）</Label>
                <Input
                  type="number"
                  min={0}
                  value={edit?.max_amount ?? ''}
                  onChange={(e) => setEdit((prev) => (prev ? { ...prev, max_amount: e.target.value } : prev))}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>审批角色序列（按顺序逐级审批，最多 8 步）</Label>
              <div className="space-y-2">
                {edit?.steps.map((role, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <span className="w-16 text-sm text-muted-foreground">第 {idx + 1} 步</span>
                    <Select
                      value={role}
                      onValueChange={(v) =>
                        setEdit((prev) => {
                          if (!prev) return prev;
                          const steps = [...prev.steps];
                          steps[idx] = v;
                          return { ...prev, steps };
                        })
                      }
                    >
                      <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="manager">业务主管</SelectItem>
                        <SelectItem value="admin">系统管理员</SelectItem>
                      </SelectContent>
                    </Select>
                    {edit.steps.length > 1 && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setEdit((prev) => {
                            if (!prev) return prev;
                            return { ...prev, steps: prev.steps.filter((_, i) => i !== idx) };
                          })
                        }
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
                {edit && edit.steps.length < 8 && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setEdit((prev) => (prev ? { ...prev, steps: [...prev.steps, 'admin'] } : prev))}
                  >
                    <Plus className="mr-1 h-4 w-4" /> 追加步骤
                  </Button>
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEdit(null)}>取消</Button>
            <Button onClick={() => void save()} disabled={saving}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
