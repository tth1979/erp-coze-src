import { BalanceList } from '@/components/finance/balance-list';
import { FinBills } from '@/components/finance/fin-bills';

export default function PayablesPage() {
  return (
    <div className="space-y-6">
      <BalanceList kind="payable" />
      <FinBills kind="payable" />
    </div>
  );
}