import { Badge } from '@/components/ui/badge';

const STATUS_META: Record<string, { label: string; className: string }> = {
  draft: { label: '草稿', className: 'border-stone-400/40 bg-stone-400/10 text-stone-500' },
  confirmed: { label: '已确认', className: 'border-blue-600/30 bg-blue-600/10 text-blue-700' },
  completed: { label: '已完成', className: 'border-green-600/30 bg-green-600/10 text-green-700' },
  cancelled: { label: '已取消', className: 'border-red-600/30 bg-red-600/10 text-red-600' },
};

export function PoStatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? { label: status, className: '' };
  return (
    <Badge variant="outline" className={meta.className}>
      {meta.label}
    </Badge>
  );
}

export const PO_STATUS_OPTIONS = [
  { value: 'draft', label: '草稿' },
  { value: 'confirmed', label: '已确认' },
  { value: 'completed', label: '已完成' },
  { value: 'cancelled', label: '已取消' },
] as const;
