'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Package, ShoppingCart, Truck, Users } from 'lucide-react';
import { apiFetch } from '@/lib/api-client';
import type { OverviewStats } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

const CARDS = [
  { key: 'customers', title: '客户档案', href: '/master-data/customers', icon: Users },
  { key: 'suppliers', title: '供应商', href: '/master-data/suppliers', icon: Truck },
  { key: 'products', title: '商品主数据', href: '/master-data/products', icon: Package },
] as const;

export default function DashboardPage() {
  const [stats, setStats] = useState<OverviewStats | null>(null);

  useEffect(() => {
    apiFetch<OverviewStats>('/api/stats/overview')
      .then(setStats)
      .catch(() => setStats({ customers: 0, suppliers: 0, products: 0 }));
  }, []);

  const po = stats?.purchase_orders;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">仪表盘</h1>
        <p className="text-sm text-muted-foreground">基础资料与采购业务概览</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {CARDS.map((card) => (
          <Card key={card.key}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{card.title}</CardTitle>
              <card.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {stats ? (
                <p className="text-2xl font-semibold tabular-nums">{stats[card.key]}</p>
              ) : (
                <Skeleton className="h-8 w-16" />
              )}
              <Link
                href={card.href}
                className="mt-2 inline-flex items-center gap-1 text-sm text-primary hover:underline"
              >
                进入管理
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </CardContent>
          </Card>
        ))}

        {/* 采购订单卡片：总数 + 草稿/已确认子指标 */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">采购订单</CardTitle>
            <ShoppingCart className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {po ? (
              <>
                <p className="text-2xl font-semibold tabular-nums">{po.total}</p>
                <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                  草稿 {po.draft} · 已确认 {po.confirmed}
                </p>
              </>
            ) : (
              <Skeleton className="h-8 w-16" />
            )}
            <Link
              href="/purchase/orders"
              className="mt-2 inline-flex items-center gap-1 text-sm text-primary hover:underline"
            >
              进入管理
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">里程碑说明</CardTitle>
        </CardHeader>
        <CardContent className="text-sm leading-6 text-muted-foreground">
          当前已交付：登录认证、角色权限雏形、基础资料（客户 / 供应商 / 商品主数据）、采购订单（草稿 →
          确认 → 完成，含明细行与金额核算）。销售、库存、财务、加工、税务等模块将按里程碑迭代接入。
        </CardContent>
      </Card>
    </div>
  );
}
