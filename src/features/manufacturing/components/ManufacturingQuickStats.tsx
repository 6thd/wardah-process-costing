/**
 * Manufacturing Orders Quick Stats Component
 * Extracted to reduce complexity
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import type { ManufacturingOrder } from '@/lib/supabase';

interface QuickStatsProps {
  readonly orders: ManufacturingOrder[];
}

interface StatItemProps {
  readonly value: number;
  readonly label: string;
  readonly color: string;
}

function StatItem({ value, label, color }: StatItemProps) {
  return (
    <div className="bg-card rounded-lg border p-4">
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-sm text-muted-foreground">{label}</div>
    </div>
  );
}

export function ManufacturingQuickStats({ orders }: QuickStatsProps) {
  const { t } = useTranslation();

  const stats = [
    {
      value: orders.filter(o => o.status === 'in-progress').length,
      label: t('manufacturing.ordersPage.stats.inProgress'),
      color: 'text-blue-600'
    },
    {
      value: orders.filter(o => o.status === 'completed').length,
      label: t('manufacturing.ordersPage.stats.completed'),
      color: 'text-green-600'
    },
    {
      value: orders.filter(o => o.status === 'draft').length,
      label: t('manufacturing.ordersPage.stats.drafts'),
      color: 'text-amber-600'
    },
    {
      value: orders.length,
      label: t('manufacturing.ordersPage.stats.total'),
      color: 'text-purple-600'
    }
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
      {stats.map((stat) => (
        <StatItem key={stat.label} {...stat} />
      ))}
    </div>
  );
}
