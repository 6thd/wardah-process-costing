import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { getGlassClasses } from '@/lib/wardah-ui-utils';

interface WIPReportProps {
  dateRange?: { from?: Date; to?: Date };
}

interface WIPRecord {
  order_number: string;
  product_name: string;
  status: string;
  qty_planned: number;
  qty_produced: number;
  materials_cost: number;
  labor_cost: number;
  overhead_applied: number;
  total_wip_cost: number;
  current_unit_cost: number;
}

export const WIPReport: React.FC<WIPReportProps> = ({ dateRange }) => {
  const { data: wipRecords, isLoading, error } = useQuery({
    queryKey: ['wip-report', dateRange],
    queryFn: async () => {
      if (!supabase) throw new Error('Supabase client not initialized');
      
      // For now, we'll fetch from the wip_by_stage view
      // In a real implementation, this would be a more complex query
      let query = supabase
        .from('wip_by_stage')
        .select('*');
      
      // Apply date filters if provided
      if (dateRange?.from) {
        // Assuming there's a created_at field we can filter on
        query = query.gte('created_at', dateRange.from.toISOString());
      }
      
      if (dateRange?.to) {
        query = query.lte('created_at', dateRange.to.toISOString());
      }
      
      const { data, error } = await query;
      
      if (error) throw error;
      return data as WIPRecord[];
    }
  });

  if (isLoading) {
    return <div className="p-4 wardah-animation-float">جارٍ تحميل تقرير WIP...</div>;
  }

  if (error) {
    return (
      <div className="p-4">
        <Alert variant="destructive" className={getGlassClasses()}>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            حدث خطأ أثناء تحميل تقرير WIP: {error.message}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <Card className={getGlassClasses()}>
      <CardHeader>
        <CardTitle className="text-right">تقرير WIP حسب المراحل</CardTitle>
      </CardHeader>
      <CardContent>
        {wipRecords && wipRecords.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">رقم الأمر</TableHead>
                <TableHead className="text-right">اسم المنتج</TableHead>
                <TableHead className="text-right">الحالة</TableHead>
                <TableHead className="text-right">المخطط</TableHead>
                <TableHead className="text-right">المنتج</TableHead>
                <TableHead className="text-right">تكلفة المواد</TableHead>
                <TableHead className="text-right">تكلفة العمالة</TableHead>
                <TableHead className="text-right">تكلفة الأوفرهيد</TableHead>
                <TableHead className="text-right">إجمالي التكلفة</TableHead>
                <TableHead className="text-right">تكلفة الوحدة</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {wipRecords.map((record) => {
                const recordKey = `${record.order_number || ''}-${record.product_name || ''}-${record.status || ''}`
                
                const getStatusClass = () => {
                  if (record.status === 'in_progress') return 'bg-yellow-100 text-yellow-800'
                  if (record.status === 'completed') return 'bg-green-100 text-green-800'
                  return 'bg-gray-100 text-gray-800'
                }
                
                const getStatusText = () => {
                  if (record.status === 'in_progress') return 'قيد التنفيذ'
                  if (record.status === 'completed') return 'مكتمل'
                  return record.status || ''
                }
                
                return (
                  <TableRow key={recordKey}>
                    <TableCell className="text-right">{record.order_number}</TableCell>
                    <TableCell className="text-right">{record.product_name}</TableCell>
                    <TableCell className="text-right">
                      <span className={`px-2 py-1 rounded-full text-xs ${getStatusClass()}`}>
                        {getStatusText()}
                      </span>
                    </TableCell>
                  <TableCell className="text-right">{record.qty_planned.toLocaleString()}</TableCell>
                  <TableCell className="text-right">{record.qty_produced.toLocaleString()}</TableCell>
                  <TableCell className="text-right">{record.materials_cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ر.س</TableCell>
                  <TableCell className="text-right">{record.labor_cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ر.س</TableCell>
                  <TableCell className="text-right">{record.overhead_applied.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ر.س</TableCell>
                  <TableCell className="text-right font-bold">{record.total_wip_cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ر.س</TableCell>
                  <TableCell className="text-right">{record.current_unit_cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ر.س</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        ) : (
          <div className="text-center py-4 text-muted-foreground">
            لا توجد بيانات WIP
          </div>
        )}
      </CardContent>
    </Card>
  );
};