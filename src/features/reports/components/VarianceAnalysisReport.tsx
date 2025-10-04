import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useWardahTheme } from '@/components/wardah-theme-provider';
import { getGlassClasses } from '@/lib/wardah-ui-utils';

interface VarianceReportProps {
  manufacturingOrderId: string;
  startDate?: string;
  endDate?: string;
}

interface MaterialVariance {
  material_code: string;
  material_name: string;
  standard_qty: number;
  actual_qty: number;
  standard_cost: number;
  actual_cost: number;
  qty_variance: number;
  price_variance: number;
  efficiency_variance: number;
  total_variance: number;
}

interface LaborVariance {
  work_center: string;
  standard_hours: number;
  actual_hours: number;
  standard_rate: number;
  actual_rate: number;
  rate_variance: number;
  efficiency_variance: number;
  total_variance: number;
}

export const VarianceAnalysisReport: React.FC<VarianceReportProps> = ({
  manufacturingOrderId,
  startDate,
  endDate
}) => {
  const { theme } = useWardahTheme();
  
  const { data: materialVariances, isLoading: loadingMaterial, error: materialError } = useQuery({
    queryKey: ['material-variances', manufacturingOrderId, startDate, endDate],
    queryFn: async () => {
      if (!supabase) throw new Error('Supabase client not initialized');
      
      const { data, error } = await supabase.rpc('calculate_material_variances', {
        p_mo_id: manufacturingOrderId,
        p_start_date: startDate ? new Date(startDate).toISOString().split('T')[0] : null,
        p_end_date: endDate ? new Date(endDate).toISOString().split('T')[0] : null
      });
      
      if (error) throw error;
      return data as MaterialVariance[];
    },
    enabled: !!manufacturingOrderId
  });

  const { data: laborVariances, isLoading: loadingLabor, error: laborError } = useQuery({
    queryKey: ['labor-variances', manufacturingOrderId],
    queryFn: async () => {
      if (!supabase) throw new Error('Supabase client not initialized');
      
      const { data, error } = await supabase.rpc('calculate_labor_variances', {
        p_mo_id: manufacturingOrderId
      });
      
      if (error) throw error;
      return data as LaborVariance[];
    },
    enabled: !!manufacturingOrderId
  });

  if (!manufacturingOrderId) {
    return (
      <div className="p-4">
        <Alert className={getGlassClasses()}>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            يرجى اختيار أمر التصنيع لعرض تحليل الانحرافات
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (loadingMaterial || loadingLabor) {
    return <div className="p-4 wardah-animation-float">جارٍ تحميل تحليل الانحرافات...</div>;
  }

  if (materialError || laborError) {
    return (
      <div className="p-4">
        <Alert variant="destructive" className={getGlassClasses()}>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            حدث خطأ أثناء تحميل تحليل الانحرافات: {materialError?.message || laborError?.message}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Material Variances */}
      <Card className={getGlassClasses()}>
        <CardHeader>
          <CardTitle className="text-right wardah-text-gradient-google">تحليل انحرافات المواد</CardTitle>
        </CardHeader>
        <CardContent>
          {materialVariances && materialVariances.length > 0 ? (
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
                {materialVariances.map((variance, index) => (
                  <TableRow key={index}>
                    <TableCell className="text-right">{variance.material_code}</TableCell>
                    <TableCell className="text-right">{variance.material_name}</TableCell>
                    <TableCell className="text-right">{parseFloat(variance.standard_qty.toString()).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                    <TableCell className="text-right">{parseFloat(variance.actual_qty.toString()).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                    <TableCell className={`text-right ${parseFloat(variance.qty_variance.toString()) >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                      {parseFloat(variance.qty_variance.toString()).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ر.س
                    </TableCell>
                    <TableCell className={`text-right ${parseFloat(variance.price_variance.toString()) >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                      {parseFloat(variance.price_variance.toString()).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ر.س
                    </TableCell>
                    <TableCell className={`text-right ${parseFloat(variance.efficiency_variance.toString()) >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                      {parseFloat(variance.efficiency_variance.toString()).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ر.س
                    </TableCell>
                    <TableCell className={`text-right font-bold ${parseFloat(variance.total_variance.toString()) >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                      {parseFloat(variance.total_variance.toString()).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ر.س
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-4 text-muted-foreground">
              لا توجد بيانات انحرافات مواد
            </div>
          )}
        </CardContent>
      </Card>

      {/* Labor Variances */}
      <Card className={getGlassClasses()}>
        <CardHeader>
          <CardTitle className="text-right wardah-text-gradient-google">تحليل انحرافات العمالة</CardTitle>
        </CardHeader>
        <CardContent>
          {laborVariances && laborVariances.length > 0 ? (
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
                {laborVariances.map((variance, index) => (
                  <TableRow key={index}>
                    <TableCell className="text-right">{variance.work_center}</TableCell>
                    <TableCell className="text-right">{parseFloat(variance.standard_hours.toString()).toFixed(2)}</TableCell>
                    <TableCell className="text-right">{parseFloat(variance.actual_hours.toString()).toFixed(2)}</TableCell>
                    <TableCell className="text-right">{parseFloat(variance.standard_rate.toString()).toFixed(2)} ر.س/ساعة</TableCell>
                    <TableCell className="text-right">{parseFloat(variance.actual_rate.toString()).toFixed(2)} ر.س/ساعة</TableCell>
                    <TableCell className={`text-right ${parseFloat(variance.rate_variance.toString()) >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                      {parseFloat(variance.rate_variance.toString()).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ر.س
                    </TableCell>
                    <TableCell className={`text-right ${parseFloat(variance.efficiency_variance.toString()) >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                      {parseFloat(variance.efficiency_variance.toString()).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ر.س
                    </TableCell>
                    <TableCell className={`text-right font-bold ${parseFloat(variance.total_variance.toString()) >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                      {parseFloat(variance.total_variance.toString()).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ر.س
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-4 text-muted-foreground">
              لا توجد بيانات انحرافات عمالة
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};