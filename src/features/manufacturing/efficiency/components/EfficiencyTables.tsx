/**
 * Efficiency Tables Components
 * مكونات جداول الكفاءة
 */

import React from 'react'
import { format } from 'date-fns'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import type { LaborEfficiency, WorkCenterEfficiencySummary, CostVariance, OEEReport, MaterialConsumptionReport } from '@/services/manufacturing/efficiencyService'

interface TableProps {
  isRTL: boolean
}

// =====================================================
// Work Center Efficiency Table
// =====================================================

interface WorkCenterEfficiencyTableProps extends TableProps {
  data: WorkCenterEfficiencySummary[] | undefined
  isLoading: boolean
}

export const WorkCenterEfficiencyTable: React.FC<WorkCenterEfficiencyTableProps> = ({
  data,
  isLoading,
  isRTL
}) => {
  if (isLoading) {
    return (
      <TableRow>
        <TableCell colSpan={6} className="text-center py-8">
          {isRTL ? 'جاري التحميل...' : 'Loading...'}
        </TableCell>
      </TableRow>
    )
  }

  if (!data || data.length === 0) {
    return (
      <TableRow>
        <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
          {isRTL ? 'لا توجد بيانات للفترة المحددة' : 'No data for selected period'}
        </TableCell>
      </TableRow>
    )
  }

  return (
    <>
      {data.map((wc) => (
        <TableRow key={`${wc.work_center_id}-${wc.production_date}`}>
          <TableCell className="font-medium">
            {isRTL ? wc.work_center_name_ar || wc.work_center_name : wc.work_center_name}
          </TableCell>
          <TableCell className="text-center">{wc.completed_operations}</TableCell>
          <TableCell className="text-center">{wc.total_produced?.toLocaleString()}</TableCell>
          <TableCell className="text-center">
            <Badge variant={wc.avg_setup_efficiency >= 100 ? 'default' : 'destructive'}>
              {wc.avg_setup_efficiency?.toFixed(1)}%
            </Badge>
          </TableCell>
          <TableCell className="text-center">
            <Badge variant={wc.avg_run_efficiency >= 100 ? 'default' : 'destructive'}>
              {wc.avg_run_efficiency?.toFixed(1)}%
            </Badge>
          </TableCell>
          <TableCell className="text-center">
            <Badge variant={wc.avg_overall_efficiency >= 100 ? 'default' : 'secondary'}>
              {wc.avg_overall_efficiency?.toFixed(1)}%
            </Badge>
          </TableCell>
        </TableRow>
      ))}
    </>
  )
}

// =====================================================
// OEE Report Table
// =====================================================

interface OEETableProps extends TableProps {
  data: OEEReport[] | undefined
  isLoading: boolean
}

export const OEETable: React.FC<OEETableProps> = ({
  data,
  isLoading,
  isRTL
}) => {
  if (isLoading) {
    return (
      <TableRow>
        <TableCell colSpan={6} className="text-center py-8">
          {isRTL ? 'جاري التحميل...' : 'Loading...'}
        </TableCell>
      </TableRow>
    )
  }

  if (!data || data.length === 0) {
    return (
      <TableRow>
        <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
          {isRTL ? 'لا توجد بيانات للفترة المحددة' : 'No data for selected period'}
        </TableCell>
      </TableRow>
    )
  }

  return (
    <>
      {data.map((row) => {
        const isWorldClass = row.oee_pct >= 85
        return (
          <TableRow key={`${row.work_center_id}-${row.production_date}`}>
            <TableCell>{format(new Date(row.production_date), 'yyyy-MM-dd')}</TableCell>
            <TableCell>{row.work_center_name}</TableCell>
            <TableCell className="text-center">
              <Badge variant={row.availability_pct >= 90 ? 'default' : 'destructive'}>
                {row.availability_pct?.toFixed(1)}%
              </Badge>
            </TableCell>
            <TableCell className="text-center">
              <Badge variant={row.performance_pct >= 95 ? 'default' : 'destructive'}>
                {row.performance_pct?.toFixed(1)}%
              </Badge>
            </TableCell>
            <TableCell className="text-center">
              <Badge variant={row.quality_pct >= 99 ? 'default' : 'destructive'}>
                {row.quality_pct?.toFixed(1)}%
              </Badge>
            </TableCell>
            <TableCell className="text-center">
              <Badge variant={isWorldClass ? 'default' : 'secondary'} className={cn(
                isWorldClass && 'bg-green-500'
              )}>
                {row.oee_pct?.toFixed(1)}%
              </Badge>
            </TableCell>
          </TableRow>
        )
      })}
    </>
  )
}

// =====================================================
// Labor Efficiency Table
// =====================================================

interface LaborEfficiencyTableProps extends TableProps {
  data: LaborEfficiency[] | undefined
  isLoading: boolean
}

export const LaborEfficiencyTable: React.FC<LaborEfficiencyTableProps> = ({
  data,
  isLoading,
  isRTL
}) => {
  if (isLoading) {
    return (
      <TableRow>
        <TableCell colSpan={6} className="text-center py-8">
          {isRTL ? 'جاري التحميل...' : 'Loading...'}
        </TableCell>
      </TableRow>
    )
  }

  if (!data || data.length === 0) {
    return (
      <TableRow>
        <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
          {isRTL ? 'لا توجد بيانات للفترة المحددة' : 'No data for selected period'}
        </TableCell>
      </TableRow>
    )
  }

  return (
    <>
      {data.map((row) => {
        const efficiencyVariant = row.overall_efficiency_pct >= 100 ? 'default' : 'destructive'
        const scrapVariant = row.scrap_rate_pct <= 1 ? 'default' : 'destructive'
        
        return (
          <TableRow key={`${row.work_order_number}-${row.actual_end_date || ''}`}>
            <TableCell className="font-mono">{row.work_order_number}</TableCell>
            <TableCell>{row.operation_name}</TableCell>
            <TableCell className="text-center">
              {((row.planned_setup_time || 0) + (row.planned_run_time || 0)).toFixed(0)} min
            </TableCell>
            <TableCell className="text-center">
              {((row.actual_setup_time || 0) + (row.actual_run_time || 0)).toFixed(0)} min
            </TableCell>
            <TableCell className="text-center">
              <Badge variant={efficiencyVariant}>
                {row.overall_efficiency_pct?.toFixed(1)}%
              </Badge>
            </TableCell>
            <TableCell className="text-center">
              <Badge variant={scrapVariant}>
                {row.scrap_rate_pct?.toFixed(2)}%
              </Badge>
            </TableCell>
          </TableRow>
        )
      })}
    </>
  )
}

// =====================================================
// Cost Variance Table
// =====================================================

interface CostVarianceTableProps extends TableProps {
  data: CostVariance[] | undefined
  isLoading: boolean
}

export const CostVarianceTable: React.FC<CostVarianceTableProps> = ({
  data,
  isLoading,
  isRTL
}) => {
  if (isLoading) {
    return (
      <TableRow>
        <TableCell colSpan={5} className="text-center py-8">
          {isRTL ? 'جاري التحميل...' : 'Loading...'}
        </TableCell>
      </TableRow>
    )
  }

  if (!data || data.length === 0) {
    return (
      <TableRow>
        <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
          {isRTL ? 'لا توجد بيانات للفترة المحددة' : 'No data for selected period'}
        </TableCell>
      </TableRow>
    )
  }

  return (
    <>
      {data.map((row) => {
        const totalPlanned = (row.planned_labor_cost || 0) + (row.planned_overhead_cost || 0)
        const totalActual = (row.actual_labor_cost || 0) + (row.actual_overhead_cost || 0)
        const totalVariance = (row.labor_variance || 0) + (row.overhead_variance || 0)
        const badgeVariant = totalVariance <= 0 ? 'default' : 'destructive'
        
        return (
          <TableRow key={`${row.work_order_number}-${row.actual_end_date || ''}`}>
            <TableCell className="font-mono">{row.work_order_number}</TableCell>
            <TableCell>{row.operation_name}</TableCell>
            <TableCell className="text-center">{totalPlanned.toLocaleString()} SAR</TableCell>
            <TableCell className="text-center">{totalActual.toLocaleString()} SAR</TableCell>
            <TableCell className="text-center">
              <Badge variant={badgeVariant} className={cn(
                totalVariance < 0 && 'bg-green-500'
              )}>
                {totalVariance > 0 ? '+' : ''}{totalVariance.toLocaleString()} SAR
              </Badge>
            </TableCell>
          </TableRow>
        )
      })}
    </>
  )
}

// =====================================================
// Material Consumption Table
// =====================================================

interface MaterialConsumptionTableProps extends TableProps {
  data: MaterialConsumptionReport[] | undefined
  isLoading: boolean
}

export const MaterialConsumptionTable: React.FC<MaterialConsumptionTableProps> = ({
  data,
  isLoading,
  isRTL
}) => {
  if (isLoading) {
    return (
      <TableRow>
        <TableCell colSpan={6} className="text-center py-8">
          {isRTL ? 'جاري التحميل...' : 'Loading...'}
        </TableCell>
      </TableRow>
    )
  }

  if (!data || data.length === 0) {
    return (
      <TableRow>
        <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
          {isRTL ? 'لا توجد بيانات للفترة المحددة' : 'No data for selected period'}
        </TableCell>
      </TableRow>
    )
  }

  return (
    <>
      {data.map((row) => {
        const variancePct = row.variance_pct || 0
        const varianceVariant = variancePct <= 5 ? 'default' : 'destructive'
        const varianceSign = variancePct > 0 ? '+' : ''
        
        return (
          <TableRow key={`${row.work_order_number}-${row.item_code}-${row.consumption_date}`}>
            <TableCell className="font-mono">{row.work_order_number}</TableCell>
            <TableCell>{row.item_name}</TableCell>
            <TableCell className="text-center">{row.planned_quantity?.toLocaleString()}</TableCell>
            <TableCell className="text-center">{row.consumed_quantity?.toLocaleString()}</TableCell>
            <TableCell className="text-center">
              <Badge variant={varianceVariant}>
                {varianceSign}{row.variance_pct?.toFixed(1)}%
              </Badge>
            </TableCell>
            <TableCell className="text-center">{row.total_cost?.toLocaleString()} SAR</TableCell>
          </TableRow>
        )
      })}
    </>
  )
}

