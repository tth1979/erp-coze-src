import { NextRequest } from 'next/server';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { handleError, ok } from '@/server/http';
import { DOC_TYPE_LABELS, listApprovalRules } from '@/server/system/approval-rules';

/** 审批流配置：按单据类型查看金额分级档位与角色链 */
export async function GET(request: NextRequest) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'sys.read');
    const docType = request.nextUrl.searchParams.get('doc_type') ?? undefined;
    return ok({ items: await listApprovalRules(docType), doc_type_labels: DOC_TYPE_LABELS });
  } catch (error) {
    return handleError(error);
  }
}
