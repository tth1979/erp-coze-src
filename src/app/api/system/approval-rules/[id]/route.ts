import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { fail, handleError, ok } from '@/server/http';
import { clientIp, writeAuditLog } from '@/server/system/audit';
import { updateApprovalRule } from '@/server/system/approval-rules';

const updateSchema = z.object({
  min_amount: z.number().min(0).optional(),
  max_amount: z.number().positive().nullish(),
  steps: z
    .array(
      z.object({
        step_no: z.number().int().min(1).max(8),
        approver_role: z.enum(['manager', 'admin']),
      }),
    )
    .min(1)
    .max(8)
    .optional(),
});

/** 更新审批档位金额区间与步骤角色序列（变更写审计） */
export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'sys.write');
    const { id } = await context.params;
    const input = updateSchema.parse(await request.json());
    const { before, after } = await updateApprovalRule(id, {
      min_amount: input.min_amount,
      max_amount: input.max_amount === undefined ? undefined : (input.max_amount ?? null),
      steps: input.steps,
    });
    await writeAuditLog({
      userId: user.id,
      username: user.username,
      action: 'approval_rule.update',
      resource: 'po_approval_rule',
      resourceId: id,
      detail: {
        doc_type: after.doc_type,
        before: { min_amount: before.min_amount, max_amount: before.max_amount, steps: before.steps },
        after: { min_amount: after.min_amount, max_amount: after.max_amount, steps: after.steps },
      },
      ip: clientIp(request),
    });
    return ok(after);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return fail('SYS.BAD_REQUEST', error.issues[0]?.message ?? '请求参数错误', 400);
    }
    return handleError(error);
  }
}
