/**
 * 审批流配置（po_approval_rules / po_approval_rule_steps 可视化维护）
 * - 按单据类型查看金额分级档位与角色链
 * - 档位 min/max 金额与每档步骤角色序列可改；步骤整体替换
 * - 配置变更由路由层写审计日志
 */
import { ApiError } from '@/server/http';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { throwDbError } from '@/server/master-data/helpers';

const RULE_TABLE = 'po_approval_rules';
const STEP_TABLE = 'po_approval_rule_steps';

export const APPROVAL_DOC_TYPES = [
  'requisition',
  'order',
  'receipt',
  'return',
  'sales_order',
  'sales_shipment',
  'sales_return',
  'transfer',
  'check',
  'expense',
] as const;

export const DOC_TYPE_LABELS: Record<string, string> = {
  requisition: '采购申请单',
  order: '采购订单',
  receipt: '采购入库单',
  return: '采购退货单',
  sales_order: '销售订单',
  sales_shipment: '销售出库单',
  sales_return: '销售退货单',
  transfer: '库存调拨单',
  check: '库存盘点单',
  expense: '费用报销单',
};

export interface RuleStepView {
  id: string;
  step_no: number;
  approver_role: string;
}

export interface RuleView {
  id: string;
  doc_type: string;
  doc_type_label: string;
  level: number;
  min_amount: number;
  max_amount: number | null;
  steps: RuleStepView[];
}

export async function listApprovalRules(docType?: string): Promise<RuleView[]> {
  const supabase = getSupabaseClient();
  let q = supabase.from(RULE_TABLE).select('*').order('doc_type', { ascending: true }).order('level', { ascending: true });
  if (docType) q = q.eq('doc_type', docType);
  const { data: rules, error } = await q;
  if (error) throwDbError(error, '查询审批规则');
  const ruleIds = (rules ?? []).map((r) => String((r as Record<string, unknown>).id));
  const stepMap = new Map<string, RuleStepView[]>();
  if (ruleIds.length > 0) {
    const { data: steps, error: sErr } = await supabase
      .from(STEP_TABLE)
      .select('*')
      .in('rule_id', ruleIds)
      .order('step_no', { ascending: true });
    if (sErr) throwDbError(sErr, '查询审批步骤');
    for (const s of steps ?? []) {
      const row = s as Record<string, unknown>;
      const list = stepMap.get(String(row.rule_id)) ?? [];
      list.push({ id: String(row.id), step_no: Number(row.step_no), approver_role: String(row.approver_role) });
      stepMap.set(String(row.rule_id), list);
    }
  }
  return (rules ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    const dt = String(row.doc_type);
    return {
      id: String(row.id),
      doc_type: dt,
      doc_type_label: DOC_TYPE_LABELS[dt] ?? dt,
      level: Number(row.level),
      min_amount: Number(row.min_amount),
      max_amount: row.max_amount === null || row.max_amount === undefined ? null : Number(row.max_amount),
      steps: stepMap.get(String(row.id)) ?? [],
    };
  });
}

export interface RuleUpdateInput {
  min_amount?: number;
  max_amount?: number | null;
  steps?: Array<{ step_no: number; approver_role: string }>;
}

/** 更新档位金额区间与步骤角色序列（步骤整体替换）；返回变更前后供审计 */
export async function updateApprovalRule(id: string, input: RuleUpdateInput): Promise<{ before: RuleView; after: RuleView }> {
  const supabase = getSupabaseClient();
  const [before] = await listApprovalRules().then((rules) => rules.filter((r) => r.id === id));
  if (!before) throw new ApiError(404, 'SYS.NOT_FOUND', '审批规则不存在');

  const patch: Record<string, unknown> = {};
  if (input.min_amount !== undefined) {
    if (input.min_amount < 0) throw new ApiError(400, 'SYS.BAD_AMOUNT', '金额下限不能为负');
    patch.min_amount = String(input.min_amount.toFixed(2));
  }
  if (input.max_amount !== undefined) {
    if (input.max_amount !== null && input.max_amount <= 0) throw new ApiError(400, 'SYS.BAD_AMOUNT', '金额上限必须为正或留空（无上限）');
    patch.max_amount = input.max_amount === null ? null : String(input.max_amount.toFixed(2));
  }
  if (Object.keys(patch).length > 0) {
    const { error } = await supabase.from(RULE_TABLE).update(patch).eq('id', id);
    if (error) throwDbError(error, '更新审批规则');
  }

  if (input.steps) {
    const steps = [...input.steps].sort((a, b) => a.step_no - b.step_no);
    if (steps.length === 0) throw new ApiError(400, 'SYS.BAD_STEPS', '至少保留一级审批步骤');
    for (const s of steps) {
      if (!['manager', 'admin'].includes(s.approver_role)) {
        throw new ApiError(400, 'SYS.BAD_ROLE', '审批角色仅支持 manager/admin');
      }
    }
    // 步骤号必须从 1 连续
    steps.forEach((s, idx) => {
      if (s.step_no !== idx + 1) throw new ApiError(400, 'SYS.BAD_STEPS', '步骤号必须从 1 开始连续编号');
    });
    const { error: delErr } = await supabase.from(STEP_TABLE).delete().eq('rule_id', id);
    if (delErr) throwDbError(delErr, '重置审批步骤');
    const { error: insErr } = await supabase
      .from(STEP_TABLE)
      .insert(steps.map((s) => ({ rule_id: id, step_no: s.step_no, approver_role: s.approver_role })));
    if (insErr) throwDbError(insErr, '写入审批步骤');
  }

  const [after] = await listApprovalRules().then((rules) => rules.filter((r) => r.id === id));
  return { before, after };
}
