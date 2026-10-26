import { Badge } from '@/components/ui/badge';

export function StatusBadge({ status }: { status: string }) {
  if (status === 'active') {
    return (
      <Badge variant="outline" className="border-green-600/30 bg-green-600/10 text-green-700">
        启用
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="border-stone-400/40 bg-stone-400/10 text-stone-500">
      停用
    </Badge>
  );
}
