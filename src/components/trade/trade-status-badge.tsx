import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/**
 * 购销单据状态徽章。
 * 采购 V2 状态机：draft 草稿 / pending 待审 / approved 已审 / rejected 已驳回
 *   / received 已入库 / closed 已关闭；入库单另有 reversed 已冲回。
 * 销售 V2 状态机：draft / pending / approved / rejected / shipped 已出库 / closed。
 */
const STATUS_META: Record<string, { label: string; className: string }> = {
  draft: { label: '草稿', className: 'bg-stone-100 text-stone-600 border-stone-200' },
  pending: { label: '待审批', className: 'bg-amber-50 text-amber-700 border-amber-200' },
  approved: { label: '已审批', className: 'bg-blue-50 text-blue-700 border-blue-200' },
  rejected: { label: '已驳回', className: 'bg-red-50 text-red-700 border-red-200' },
  received: { label: '已入库', className: 'bg-green-50 text-green-700 border-green-200' },
  shipped: { label: '已出库', className: 'bg-green-50 text-green-700 border-green-200' },
  reversed: { label: '已冲回', className: 'bg-purple-50 text-purple-700 border-purple-200' },
  closed: { label: '已关闭', className: 'bg-stone-100 text-stone-500 border-stone-200' },
  confirmed: { label: '已确认', className: 'bg-blue-50 text-blue-700 border-blue-200' },
  completed: { label: '已完成', className: 'bg-green-50 text-green-700 border-green-200' },
  cancelled: { label: '已取消', className: 'bg-stone-100 text-stone-500 border-stone-200' },
};

export function TradeStatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? { label: status, className: 'bg-stone-100 text-stone-600 border-stone-200' };
  return (
    <Badge variant="outline" className={cn('font-normal', meta.className)}>
      {meta.label}
    </Badge>
  );
}

/** 采购订单状态过滤选项（V2） */
export const PURCHASE_STATUS_OPTIONS = [
  { value: 'draft', label: '草稿' },
  { value: 'pending', label: '待审批' },
  { value: 'approved', label: '已审批' },
  { value: 'rejected', label: '已驳回' },
  { value: 'received', label: '已入库' },
  { value: 'closed', label: '已关闭' },
];

/** 入库单状态过滤选项 */
export const RECEIPT_STATUS_OPTIONS = [
  { value: 'draft', label: '草稿' },
  { value: 'pending', label: '待审批' },
  { value: 'approved', label: '已入库' },
  { value: 'rejected', label: '已驳回' },
  { value: 'reversed', label: '已冲回' },
];

/** 申请单/退货单状态过滤选项 */
export const DOC_STATUS_OPTIONS = [
  { value: 'draft', label: '草稿' },
  { value: 'pending', label: '待审批' },
  { value: 'approved', label: '已审批' },
  { value: 'rejected', label: '已驳回' },
  { value: 'closed', label: '已关闭' },
];

/** 销售订单状态过滤选项（V2） */
export const SALES_STATUS_OPTIONS = [
  { value: 'draft', label: '草稿' },
  { value: 'pending', label: '待审批' },
  { value: 'approved', label: '已审批' },
  { value: 'rejected', label: '已驳回' },
  { value: 'shipped', label: '已出库' },
  { value: 'closed', label: '已关闭' },
];

/** 出库单状态过滤选项（approved 即已出库） */
export const SHIPMENT_STATUS_OPTIONS = [
  { value: 'draft', label: '草稿' },
  { value: 'pending', label: '待审批' },
  { value: 'approved', label: '已出库' },
  { value: 'rejected', label: '已驳回' },
];

/** 销售退货单状态过滤选项（approved 即已回补入库） */
export const SALES_RETURN_STATUS_OPTIONS = [
  { value: 'draft', label: '草稿' },
  { value: 'pending', label: '待审批' },
  { value: 'approved', label: '已审批' },
  { value: 'rejected', label: '已驳回' },
];

/** 兼容旧引用（销售模块仍使用） */
export const TRADE_STATUS_OPTIONS = SALES_STATUS_OPTIONS;

/** 库存调拨单状态过滤选项（received = 已收货） */
export const TRANSFER_STATUS_OPTIONS = [
  { value: 'draft', label: '草稿' },
  { value: 'pending', label: '待审批' },
  { value: 'approved', label: '已调出（在途）' },
  { value: 'received', label: '已收货' },
  { value: 'rejected', label: '已驳回' },
  { value: 'closed', label: '已关闭' },
];

/** 库存盘点单状态过滤选项（approved = 差异已过账） */
export const CHECK_STATUS_OPTIONS = [
  { value: 'draft', label: '草稿' },
  { value: 'pending', label: '待审批' },
  { value: 'approved', label: '已过账' },
  { value: 'rejected', label: '已驳回' },
  { value: 'closed', label: '已关闭' },
];
