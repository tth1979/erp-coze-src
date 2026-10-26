'use client';

import ReportPanel from '@/components/reports/report-panel';

export default function SalesReportPage() {
  return (
    <ReportPanel
      title="销售报表"
      description="按客户 / 商品 / 月份汇总已出库销售（shipped）净额，支持日期范围"
      endpoint="/api/report/sales"
      defaultGroup="customer"
      groups={[
        { value: 'customer', label: '按客户' },
        { value: 'product', label: '按商品' },
        { value: 'month', label: '按月份' },
      ]}
    />
  );
}