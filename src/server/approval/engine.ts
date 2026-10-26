/**
 * 通用单据审批引擎：提交 → 分级审批 → 通过/驳回
 *
 * 规则：po_approval_rules（doc_type + 金额区间 → level）+ po_approval_rule_steps（角色链）。
 * 实例：提交时把规则步骤快照为 po_approval_steps，逐级推进（单据 current_step 记录当前步）。
 *
 * 角色匹配：step.approver_role = 'manager' 时 manager/admin 可审；'admin' 仅 admin 可审。
 * 终态处理：
 * - requisition / order / sales_order → 审批完成直接置 approved
 * - receipt / return / shipment / sales_return / transfer / check → 调数据库函数
 *   （单事务完成状态流转 + 库存 + 台账 + 成本，库存不足整单回滚）
 */
import { ApiError } from '@/server/http';
import { throwInventoryRpcError } from '@/server/inventory/shared';
import { throwDbError } from '@/server/master-data/helpers';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import type { PoApprovalRule, PoApprovalRuleStep, PoApprovalStep, SysUser } from '@/storage/database/shared/schema';

export type ApprovalDocType =
  | 'requisition'
  | 'order'
  | 'receipt'
  | 'return'
  | 'sales_order'
  | 'shipment'
  | 'sales_return'
  | 'transfer'
  | 'check';

const DOC_TABLE: Record<ApprovalDocType, string> = {
  requisition: 'po_requisitions',
  order: 'po_purchase_orders',
  receipt: 'po_receipts',
  return: 'po_returns',
  sales_order: 'so_sales_orders',
  shipment: 'so_shipments',
  sales_return: 'so_returns',
  transfer: 'inv_transfers',
  check: 'inv_checks',
};

const DOC_NAME: Record<ApprovalDocType, string> = {
  requisition: '采购申请单',
  order: '采购订单',
  receipt: '采购入库单',
  return: '采购退货单',
  sales_order: '销售订单',
  shipment: '销售出库单',
  sales_return: '销售退货单',
  transfer: '库存调拨单',
  check: '库存盘点单',
};

/** 终审通过后需由数据库函数完成库存/成本流转的单据 → 函数名与参数名 */
const EXECUTE_RPC: Partial<Record<ApprovalDocType, { fn: string; param: string }>> = {
  receipt: { fn: 'po_execute_receipt', param: 'p_receipt_id' },
  return: { fn: 'po_execute_return', param: 'p_return_id' },
  shipment: { fn: 'so_execute_shipment', param: 'p_shipment_id' },
  sales_return: { fn: 'so_execute_return', param: 'p_return_id' },
  transfer: { fn: 'inv_execute_transfer', param: 'p_transfer_id' },
  check: { fn: 'inv_execute_check', param: 'p_check_id' },
};

export interface ApprovalStepView {
  id: string;
  step_no: number;
  approver_role: string;
  status: string;
  approver_name: string | null;
  comment: string | null;
  acted_at: string | null;
}

/** 金额命中审批规则（无匹配时兜底一级经理审批，保证流程可走通） */
async function resolveRule(
  docType: ApprovalDocType,
  amount: number,
): Promise<{ rule: PoApprovalRule; steps: PoApprovalRuleStep[] }> {
  const supabase = getSupabaseClient();
  const { data: rules, error } = await supabase
    .from('po_approval_rules')
    .select('*')
    .eq('doc_type', docType)
    .order('level', { ascending: true });
  if (error) throwDbError(error, '查询审批规则');
  const matched =
    (rules ?? []).find(
      (r) =>
        amount >= Number(r.min_amount) && (r.max_amount === null || amount < Number(r.max_amount)),
    ) ?? null;
  if (!matched) throw new ApiError(400, 'PO.APPROVAL_RULE_MISSING', '未配置匹配的审批规则');

  const { data: steps, error: sErr } = await supabase
    .from('po_approval_rule_steps')
    .select('*')
    .eq('rule_id', matched.id)
    .order('step_no', { ascending: true });
  if (sErr) throwDbError(sErr, '查询审批步骤');
  if (!steps || steps.length === 0) throw new ApiError(400, 'PO.APPROVAL_RULE_MISSING', '审批规则未配置步骤');
  return { rule: matched as PoApprovalRule, steps: steps as PoApprovalRuleStep[] };
}

interface DocRow {
  id: string;
  status: string;
}

async function loadDoc(docType: ApprovalDocType, docId: string): Promise<DocRow> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from(DOC_TABLE[docType])
    .select('id, status')
    .eq('id', docId)
    .maybeSingle();
  if (error) throwDbError(error, `查询${DOC_NAME[docType]}`);
  if (!data) throw new ApiError(404, 'PO.NOT_FOUND', `${DOC_NAME[docType]}不存在`);
  return data as DocRow;
}

/** 提交审批：draft/rejected → pending，生成审批步骤实例 */
export async function submitDocument(
  docType: ApprovalDocType,
  docId: string,
  amount: number,
  user: SysUser,
): Promise<void> {
  const doc = await loadDoc(docType, docId);
  if (doc.status !== 'draft' && doc.status !== 'rejected') {
    throw new ApiError(400, 'PO.BAD_TRANSITION', '仅草稿或已驳回的单据可提交审批');
  }
  const { rule, steps } = await resolveRule(docType, amount);

  const supabase = getSupabaseClient();
  // 重新提交：清掉旧步骤实例（草稿期无并发，直接删）
  const { error: delErr } = await supabase
    .from('po_approval_steps')
    .delete()
    .eq('doc_type', docType)
    .eq('doc_id', docId);
  if (delErr) throwDbError(delErr, '清理旧审批步骤');

  const { error: insErr } = await supabase.from('po_approval_steps').insert(
    steps.map((s) => ({
      doc_type: docType,
      doc_id: docId,
      step_no: s.step_no,
      approver_role: s.approver_role,
      status: 'pending',
    })),
  );
  if (insErr) throwDbError(insErr, '生成审批步骤');

  const { error: updErr } = await supabase
    .from(DOC_TABLE[docType])
    .update({
      status: 'pending',
      approval_level: rule.level,
      current_step: 1,
      submitted_by: user.id,
      submitted_at: new Date().toISOString(),
      reject_reason: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', docId);
  if (updErr) throwDbError(updErr, '提交审批');
}

function canActAs(user: SysUser, approverRole: string): boolean {
  if (user.role === 'admin') return true;
  if (approverRole === 'manager') return user.role === 'manager';
  return false;
}

interface CurrentStep {
  doc: DocRow;
  step: PoApprovalStep;
  remaining: number;
}

/** 取出单据当前待办步骤（含角色校验前置数据） */
async function loadCurrentStep(docType: ApprovalDocType, docId: string): Promise<CurrentStep> {
  const doc = await loadDoc(docType, docId);
  if (doc.status !== 'pending') {
    throw new ApiError(400, 'PO.BAD_TRANSITION', `${DOC_NAME[docType]}当前不在审批中`);
  }
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('po_approval_steps')
    .select('*')
    .eq('doc_type', docType)
    .eq('doc_id', docId)
    .order('step_no', { ascending: true });
  if (error) throwDbError(error, '查询审批步骤');
  const steps = (data ?? []) as PoApprovalStep[];
  const step = steps.find((s) => s.status === 'pending');
  if (!step) throw new ApiError(400, 'PO.BAD_TRANSITION', '审批步骤状态异常');
  return { doc, step, remaining: steps.filter((s) => s.status === 'pending').length - 1 };
}

/** 审批通过当前步；全部通过时执行终态流转 */
export async function approveCurrentStep(
  docType: ApprovalDocType,
  docId: string,
  user: SysUser,
  comment?: string,
): Promise<void> {
  const { step, remaining } = await loadCurrentStep(docType, docId);
  if (!canActAs(user, step.approver_role)) {
    throw new ApiError(403, 'PO.APPROVER_MISMATCH', `当前步骤需 ${step.approver_role} 角色审批`);
  }

  const supabase = getSupabaseClient();
  const { error: stepErr } = await supabase
    .from('po_approval_steps')
    .update({
      status: 'approved',
      approver_id: user.id,
      comment: comment ?? null,
      acted_at: new Date().toISOString(),
    })
    .eq('id', step.id)
    .eq('status', 'pending');
  if (stepErr) throwDbError(stepErr, '审批通过');

  if (remaining > 0) {
    // 推进到下一步
    const { error } = await supabase
      .from(DOC_TABLE[docType])
      .update({ current_step: step.step_no + 1, updated_at: new Date().toISOString() })
      .eq('id', docId);
    if (error) throwDbError(error, '推进审批步骤');
    return;
  }

  // 终审通过：终态流转
  const rpc = EXECUTE_RPC[docType];
  if (rpc) {
    // 数据库函数单事务：状态 + 库存 + 流水 + 成本
    const { error } = await supabase.rpc(rpc.fn, { [rpc.param]: docId, p_user_id: user.id });
    if (error) {
      // RPC 失败（库存不足/超订单剩余量等）：回滚当前步骤为 pending，保证单据可修正后重新审批
      const { error: rbErr } = await supabase
        .from('po_approval_steps')
        .update({ status: 'pending', approver_id: null, comment: null, acted_at: null })
        .eq('id', step.id);
      if (rbErr) throwDbError(rbErr, '回滚审批步骤');
      throwInventoryRpcError(error, DOC_NAME[docType] + '审核');
    }
    const { error: csErr } = await supabase
      .from(DOC_TABLE[docType])
      .update({ current_step: 0 })
      .eq('id', docId);
    if (csErr) throwDbError(csErr, '更新审批进度');
    return;
  }

  const { error } = await supabase
    .from(DOC_TABLE[docType])
    .update({
      status: 'approved',
      current_step: 0,
      approved_by: user.id,
      approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', docId);
  if (error) throwDbError(error, '终审通过');
}

/** 驳回当前步：单据置 rejected（可编辑后重新提交） */
export async function rejectCurrentStep(
  docType: ApprovalDocType,
  docId: string,
  user: SysUser,
  reason: string,
): Promise<void> {
  const { step } = await loadCurrentStep(docType, docId);
  if (!canActAs(user, step.approver_role)) {
    throw new ApiError(403, 'PO.APPROVER_MISMATCH', `当前步骤需 ${step.approver_role} 角色审批`);
  }
  const supabase = getSupabaseClient();
  const { error: stepErr } = await supabase
    .from('po_approval_steps')
    .update({
      status: 'rejected',
      approver_id: user.id,
      comment: reason,
      acted_at: new Date().toISOString(),
    })
    .eq('id', step.id)
    .eq('status', 'pending');
  if (stepErr) throwDbError(stepErr, '驳回审批');

  const { error } = await supabase
    .from(DOC_TABLE[docType])
    .update({
      status: 'rejected',
      reject_reason: reason,
      updated_at: new Date().toISOString(),
    })
    .eq('id', docId);
  if (error) throwDbError(error, '驳回单据');
}

/** 审批步骤时间线（含审批人姓名） */
export async function listSteps(docType: ApprovalDocType, docId: string): Promise<ApprovalStepView[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('po_approval_steps')
    .select('*')
    .eq('doc_type', docType)
    .eq('doc_id', docId)
    .order('step_no', { ascending: true });
  if (error) throwDbError(error, '查询审批步骤');
  const steps = (data ?? []) as PoApprovalStep[];
  if (steps.length === 0) return [];

  const approverIds = steps.map((s) => s.approver_id).filter((v): v is string => Boolean(v));
  const names = new Map<string, string>();
  if (approverIds.length > 0) {
    const { data: users } = await supabase
      .from('sys_users')
      .select('id, display_name')
      .in('id', [...new Set(approverIds)]);
    for (const u of users ?? []) names.set(u.id as string, u.display_name as string);
  }

  return steps.map((s) => ({
    id: s.id,
    step_no: s.step_no,
    approver_role: s.approver_role,
    status: s.status,
    approver_name: s.approver_id ? (names.get(s.approver_id) ?? null) : null,
    comment: s.comment,
    acted_at: s.acted_at ? new Date(s.acted_at).toISOString() : null,
  }));
}
