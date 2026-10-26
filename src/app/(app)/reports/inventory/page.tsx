'use client';

import ReportPanel from '@/components/reports/report-panel';

export default function InventoryReportPage() {
  return (
    <ReportPanel
      title="库存报表"
      description="按仓库 / 商品汇总现有库存余额与货值（quantity × 移动加权成本）"
      endpoint="/api/report/inventory"
      defaultGroup="warehouse"
      groups={[
        { value: 'warehouse', label: '按仓库' },
        { value: 'product', label: '按商品' },
      ]}
    />
  );
}