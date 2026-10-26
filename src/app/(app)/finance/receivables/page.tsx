import { BalanceList } from '@/components/finance/balance-list';
import { FinBills } from '@/components/finance/fin-bills';

export default function ReceivablesPage() {
  return (
    <div className="space-y-6">
      <BalanceList kind="receivable" />
      <FinBills kind="receivable" />
    </div>
  );
}