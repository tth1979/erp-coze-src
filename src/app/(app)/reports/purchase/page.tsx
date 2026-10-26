'use client';

import ReportPanel from '@/components/reports/report-panel';

export default function PurchaseReportPage() {
  return (
    <ReportPanel
      title="采购报表"
      description="按供应商 / 月份汇总已入库采购订单（received）金额"
      endpoint="/api/report/purchase"
      defaultGroup="supplier"
      groups={[
        { value: 'supplier', label: '按供应商' },
        { value: 'month', label: '按月份' },
      ]}
    />
  );
}