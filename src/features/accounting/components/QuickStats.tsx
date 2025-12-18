/**
 * Accounting Quick Stats Component
 * Extracted to reduce complexity in AccountingOverview
 */

import React from 'react';
import { Card, CardHeader, CardDescription, CardContent } from '@/components/ui/card';

interface QuickStatsProps {
  isRTL: boolean;
}

interface StatCardProps {
  label: string;
  value: string | number;
  sublabel: string;
  color: string;
}

function StatCard({ label, value, sublabel, color }: StatCardProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-bold ${color}`}>{value}</div>
        <p className="text-xs text-muted-foreground mt-1">{sublabel}</p>
      </CardContent>
    </Card>
  );
}

export function QuickStats({ isRTL }: QuickStatsProps) {
  const stats = [
    {
      labelAr: 'القيود المسودة',
      labelEn: 'Draft Entries',
      value: '-',
      sublabelAr: 'في انتظار الترحيل',
      sublabelEn: 'Pending posting',
      color: 'text-blue-600'
    },
    {
      labelAr: 'القيود المرحلة',
      labelEn: 'Posted Entries',
      value: '-',
      sublabelAr: 'تم الترحيل',
      sublabelEn: 'Posted',
      color: 'text-green-600'
    },
    {
      labelAr: 'إجمالي الحسابات',
      labelEn: 'Total Accounts',
      value: '-',
      sublabelAr: 'حسابات نشطة',
      sublabelEn: 'Active accounts',
      color: 'text-purple-600'
    },
    {
      labelAr: 'آخر قيد',
      labelEn: 'Last Entry',
      value: '-',
      sublabelAr: 'تاريخ آخر قيد',
      sublabelEn: 'Last entry date',
      color: 'text-muted-foreground text-sm'
    }
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-8">
      {stats.map((stat, index) => (
        <StatCard
          key={index}
          label={isRTL ? stat.labelAr : stat.labelEn}
          value={stat.value}
          sublabel={isRTL ? stat.sublabelAr : stat.sublabelEn}
          color={stat.color}
        />
      ))}
    </div>
  );
}
