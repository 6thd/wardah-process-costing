import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle } from 'lucide-react';
import { getGlassClasses } from '@/lib/wardah-ui-utils';

interface ProfitabilityReportProps {}

export const ProfitabilityReport: React.FC<ProfitabilityReportProps> = ({ 
}) => {
  return (
    <Card className={getGlassClasses()}>
      <CardHeader>
        <CardTitle className="text-right">تحليل الربحية</CardTitle>
      </CardHeader>
      <CardContent>
        <Alert className={getGlassClasses()}>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            تقرير تحليل الربحية قيد التطوير
          </AlertDescription>
        </Alert>
        
        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className={getGlassClasses()}>
              <div className="text-2xl font-bold text-green-600 p-4">0.00 ر.س</div>
              <div className="text-sm text-muted-foreground px-4 pb-4">إجمالي الإيرادات</div>
            </div>
            <div className={getGlassClasses()}>
              <div className="text-2xl font-bold text-red-600 p-4">0.00 ر.س</div>
              <div className="text-sm text-muted-foreground px-4 pb-4">إجمالي التكاليف</div>
            </div>
            <div className={getGlassClasses()}>
              <div className="text-2xl font-bold text-blue-600 p-4">0.00 ر.س</div>
              <div className="text-sm text-muted-foreground px-4 pb-4">الربح الإجمالي</div>
            </div>
          </div>
          
          <div className={getGlassClasses()}>
            <h3 className="font-medium mb-2 p-4 pb-0">معدل الربحية</h3>
            <div className="text-3xl font-bold text-center py-4">0.00%</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};