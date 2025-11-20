# نظام التقارير المتقدمة - Wardah ERP

## المشكلة الحالية:
- التقارير محدودة وأساسية
- عدم وجود تحليل الانحرافات
- تقارير WIP ناقصة
- عدم وجود تحليل ربحية مفصل

## الحلول المقترحة:

### 1. تقارير تحليل الانحرافات

#### أ) انحرافات المواد (Material Variances):
```sql
-- دالة حساب انحرافات المواد
CREATE OR REPLACE FUNCTION calculate_material_variances(
  p_mo_id UUID,
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL
) RETURNS TABLE (
  material_code VARCHAR,
  material_name VARCHAR,
  standard_qty DECIMAL(18,6),
  actual_qty DECIMAL(18,6),
  standard_cost DECIMAL(18,6),
  actual_cost DECIMAL(18,6),
  qty_variance DECIMAL(18,6),
  price_variance DECIMAL(18,6),
  efficiency_variance DECIMAL(18,6),
  total_variance DECIMAL(18,6)
) AS $$
BEGIN
  RETURN QUERY
  WITH material_usage AS (
    SELECT 
      p.code as material_code,
      p.name as material_name,
      bl.qty as standard_qty,
      COALESCE(SUM(sm.qty), 0) as actual_qty,
      bl.qty * sq.avg_cost as standard_cost,
      COALESCE(SUM(sm.qty * sm.unit_cost_in), 0) as actual_cost
    FROM manufacturing_orders mo
    JOIN bom_headers bh ON mo.product_id = bh.product_id
    JOIN bom_lines bl ON bh.id = bl.bom_id
    JOIN products p ON bl.component_product_id = p.id
    LEFT JOIN stock_moves sm ON sm.ref_id = mo.id::text 
      AND sm.move_type = 'material_issue'
      AND sm.product_id = p.id
    LEFT JOIN stock_quants sq ON sq.product_id = p.id
    WHERE mo.id = p_mo_id
      AND (p_start_date IS NULL OR mo.created_at >= p_start_date)
      AND (p_end_date IS NULL OR mo.created_at <= p_end_date)
    GROUP BY p.code, p.name, bl.qty, sq.avg_cost
  )
  SELECT 
    mu.material_code,
    mu.material_name,
    mu.standard_qty,
    mu.actual_qty,
    mu.standard_cost,
    mu.actual_cost,
    (mu.actual_qty - mu.standard_qty) * (mu.standard_cost / mu.standard_qty) as qty_variance,
    mu.actual_qty * ((mu.actual_cost / mu.actual_qty) - (mu.standard_cost / mu.standard_qty)) as price_variance,
    ((mu.actual_qty - mu.standard_qty) * (mu.actual_cost / mu.actual_qty)) as efficiency_variance,
    (mu.actual_cost - mu.standard_cost) as total_variance
  FROM material_usage mu;
END;
$$ LANGUAGE plpgsql;
```

#### ب) انحرافات العمالة (Labor Variances):
```sql
CREATE OR REPLACE FUNCTION calculate_labor_variances(
  p_mo_id UUID
) RETURNS TABLE (
  work_center VARCHAR,
  standard_hours DECIMAL(18,6),
  actual_hours DECIMAL(18,6),
  standard_rate DECIMAL(18,6),
  actual_rate DECIMAL(18,6),
  rate_variance DECIMAL(18,6),
  efficiency_variance DECIMAL(18,6),
  total_variance DECIMAL(18,6)
) AS $$
BEGIN
  RETURN QUERY
  WITH labor_analysis AS (
    SELECT 
      le.cost_center as work_center,
      4.5 as standard_hours, -- من الـ BOM أو Work Center routing
      le.hours as actual_hours,
      25.0 as standard_rate, -- معدل ثابت
      le.rate as actual_rate
    FROM labor_entries le
    WHERE le.mo_id = p_mo_id
  )
  SELECT 
    la.work_center,
    la.standard_hours,
    la.actual_hours,
    la.standard_rate,
    la.actual_rate,
    la.actual_hours * (la.actual_rate - la.standard_rate) as rate_variance,
    la.standard_rate * (la.actual_hours - la.standard_hours) as efficiency_variance,
    (la.actual_hours * la.actual_rate) - (la.standard_hours * la.standard_rate) as total_variance
  FROM labor_analysis la;
END;
$$ LANGUAGE plpgsql;
```

### 2. تقارير WIP المتقدمة

#### أ) تقرير WIP بالمراحل:
```sql
CREATE OR REPLACE VIEW wip_by_stage AS
SELECT 
  mo.mo_number,
  mo.product_id,
  p.name as product_name,
  mo.status,
  mo.qty_planned,
  mo.qty_produced,
  -- تكلفة المواد المصروفة
  COALESCE(SUM(CASE WHEN sm.move_type = 'material_issue' THEN sm.total_cost ELSE 0 END), 0) as materials_cost,
  -- تكلفة العمالة
  COALESCE(SUM(le.amount), 0) as labor_cost,
  -- الأوفرهيد المُطبّق
  COALESCE(SUM(oa.amount), 0) as overhead_applied,
  -- إجمالي تكلفة WIP
  COALESCE(SUM(CASE WHEN sm.move_type = 'material_issue' THEN sm.total_cost ELSE 0 END), 0) +
  COALESCE(SUM(le.amount), 0) +
  COALESCE(SUM(oa.amount), 0) as total_wip_cost,
  -- تكلفة الوحدة الحالية
  CASE 
    WHEN mo.qty_produced > 0 THEN
      (COALESCE(SUM(CASE WHEN sm.move_type = 'material_issue' THEN sm.total_cost ELSE 0 END), 0) +
       COALESCE(SUM(le.amount), 0) +
       COALESCE(SUM(oa.amount), 0)) / mo.qty_produced
    ELSE 0
  END as current_unit_cost
FROM manufacturing_orders mo
JOIN products p ON mo.product_id = p.id
LEFT JOIN stock_moves sm ON sm.ref_id = mo.id::text
LEFT JOIN labor_entries le ON le.mo_id = mo.id
LEFT JOIN overhead_allocations oa ON oa.mo_id = mo.id
WHERE mo.status IN ('in_progress', 'done')
GROUP BY mo.id, mo.mo_number, mo.product_id, p.name, mo.status, mo.qty_planned, mo.qty_produced;
```

### 3. React Components للتقارير

#### src/features/reports/components/VarianceAnalysisReport.tsx:
```typescript
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supabase } from '@/lib/supabase';

interface VarianceReportProps {
  manufacturingOrderId: string;
  startDate?: string;
  endDate?: string;
}

export const VarianceAnalysisReport: React.FC<VarianceReportProps> = ({
  manufacturingOrderId,
  startDate,
  endDate
}) => {
  const { data: materialVariances, isLoading: loadingMaterial } = useQuery({
    queryKey: ['material-variances', manufacturingOrderId, startDate, endDate],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('calculate_material_variances', {
        p_mo_id: manufacturingOrderId,
        p_start_date: startDate,
        p_end_date: endDate
      });
      
      if (error) throw error;
      return data;
    },
  });

  const { data: laborVariances, isLoading: loadingLabor } = useQuery({
    queryKey: ['labor-variances', manufacturingOrderId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('calculate_labor_variances', {
        p_mo_id: manufacturingOrderId
      });
      
      if (error) throw error;
      return data;
    },
  });

  if (loadingMaterial || loadingLabor) {
    return <div className="p-4">جارٍ تحميل تحليل الانحرافات...</div>;
  }

  return (
    <div className="space-y-6">
      {/* انحرافات المواد */}
      <Card>
        <CardHeader>
          <CardTitle className="text-right">تحليل انحرافات المواد</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">كود المادة</TableHead>
                <TableHead className="text-right">اسم المادة</TableHead>
                <TableHead className="text-right">الكمية المعيارية</TableHead>
                <TableHead className="text-right">الكمية الفعلية</TableHead>
                <TableHead className="text-right">انحراف الكمية</TableHead>
                <TableHead className="text-right">انحراف السعر</TableHead>
                <TableHead className="text-right">انحراف الكفاءة</TableHead>
                <TableHead className="text-right">إجمالي الانحراف</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {materialVariances?.map((variance: any, index: number) => (
                <TableRow key={index}>
                  <TableCell className="text-right">{variance.material_code}</TableCell>
                  <TableCell className="text-right">{variance.material_name}</TableCell>
                  <TableCell className="text-right">{parseFloat(variance.standard_qty).toLocaleString()}</TableCell>
                  <TableCell className="text-right">{parseFloat(variance.actual_qty).toLocaleString()}</TableCell>
                  <TableCell className={`text-right ${parseFloat(variance.qty_variance) >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                    {parseFloat(variance.qty_variance).toLocaleString()} ر.س
                  </TableCell>
                  <TableCell className={`text-right ${parseFloat(variance.price_variance) >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                    {parseFloat(variance.price_variance).toLocaleString()} ر.س
                  </TableCell>
                  <TableCell className={`text-right ${parseFloat(variance.efficiency_variance) >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                    {parseFloat(variance.efficiency_variance).toLocaleString()} ر.س
                  </TableCell>
                  <TableCell className={`text-right font-bold ${parseFloat(variance.total_variance) >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                    {parseFloat(variance.total_variance).toLocaleString()} ر.س
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* انحرافات العمالة */}
      <Card>
        <CardHeader>
          <CardTitle className="text-right">تحليل انحرافات العمالة</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">مركز العمل</TableHead>
                <TableHead className="text-right">الساعات المعيارية</TableHead>
                <TableHead className="text-right">الساعات الفعلية</TableHead>
                <TableHead className="text-right">المعدل المعياري</TableHead>
                <TableHead className="text-right">المعدل الفعلي</TableHead>
                <TableHead className="text-right">انحراف المعدل</TableHead>
                <TableHead className="text-right">انحراف الكفاءة</TableHead>
                <TableHead className="text-right">إجمالي الانحراف</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {laborVariances?.map((variance: any, index: number) => (
                <TableRow key={index}>
                  <TableCell className="text-right">{variance.work_center}</TableCell>
                  <TableCell className="text-right">{parseFloat(variance.standard_hours).toFixed(2)}</TableCell>
                  <TableCell className="text-right">{parseFloat(variance.actual_hours).toFixed(2)}</TableCell>
                  <TableCell className="text-right">{parseFloat(variance.standard_rate).toFixed(2)} ر.س/ساعة</TableCell>
                  <TableCell className="text-right">{parseFloat(variance.actual_rate).toFixed(2)} ر.س/ساعة</TableCell>
                  <TableCell className={`text-right ${parseFloat(variance.rate_variance) >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                    {parseFloat(variance.rate_variance).toLocaleString()} ر.س
                  </TableCell>
                  <TableCell className={`text-right ${parseFloat(variance.efficiency_variance) >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                    {parseFloat(variance.efficiency_variance).toLocaleString()} ر.س
                  </TableCell>
                  <TableCell className={`text-right font-bold ${parseFloat(variance.total_variance) >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                    {parseFloat(variance.total_variance).toLocaleString()} ر.س
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};
```

### 4. لوحة معلومات متقدمة للتقارير

#### src/features/reports/components/ReportsDashboard.tsx:
```typescript
import React, { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DatePickerWithRange } from '@/components/ui/date-range-picker';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { VarianceAnalysisReport } from './VarianceAnalysisReport';
import { WIPReport } from './WIPReport';
import { ProfitabilityReport } from './ProfitabilityReport';

export const ReportsDashboard: React.FC = () => {
  const [dateRange, setDateRange] = useState<{from: Date, to: Date}>();
  const [selectedMO, setSelectedMO] = useState<string>('');

  return (
    <div className="p-6 space-y-6">
      {/* فلاتر التقارير */}
      <div className="flex gap-4 items-center">
        <Select value={selectedMO} onValueChange={setSelectedMO}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="اختر أمر التصنيع" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="mo1">MO-2025-001</SelectItem>
            <SelectItem value="mo2">MO-2025-002</SelectItem>
          </SelectContent>
        </Select>
        
        <DatePickerWithRange
          date={dateRange}
          setDate={setDateRange}
        />
      </div>

      {/* تبويبات التقارير */}
      <Tabs defaultValue="variances" className="space-y-4">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="variances">تحليل الانحرافات</TabsTrigger>
          <TabsTrigger value="wip">تقرير WIP</TabsTrigger>
          <TabsTrigger value="profitability">تحليل الربحية</TabsTrigger>
          <TabsTrigger value="inventory">تقييم المخزون</TabsTrigger>
        </TabsList>
        
        <TabsContent value="variances" className="space-y-4">
          <VarianceAnalysisReport 
            manufacturingOrderId={selectedMO}
            startDate={dateRange?.from?.toISOString()}
            endDate={dateRange?.to?.toISOString()}
          />
        </TabsContent>
        
        <TabsContent value="wip" className="space-y-4">
          <WIPReport dateRange={dateRange} />
        </TabsContent>
        
        <TabsContent value="profitability" className="space-y-4">
          <ProfitabilityReport 
            manufacturingOrderId={selectedMO}
            dateRange={dateRange}
          />
        </TabsContent>
        
        <TabsContent value="inventory" className="space-y-4">
          {/* تقرير تقييم المخزون */}
        </TabsContent>
      </Tabs>
    </div>
  );
};
```

## النتائج المتوقعة:
✅ تقارير انحرافات مفصلة (مواد + عمالة + أوفرهيد)
✅ تحليل WIP بالمراحل مع التكاليف
✅ تقارير ربحية متقدمة
✅ لوحة معلومات تفاعلية للتقارير
✅ تصدير التقارير (PDF/Excel)
✅ فلاتر متقدمة (تاريخ، أمر تصنيع، منتج)