import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DatePicker } from './utils/datePickerHelpers';

interface SalesReportsDateFilterProps {
  readonly fromDate: Date | undefined;
  readonly toDate: Date | undefined;
  readonly onFromDateChange: (date: Date | undefined) => void;
  readonly onToDateChange: (date: Date | undefined) => void;
  readonly onViewClick: () => void;
  readonly onExportExcel: () => void;
  readonly onExportPDF: () => void;
  readonly loading: boolean;
  readonly isRTL: boolean;
}

export function SalesReportsDateFilter({
  fromDate,
  toDate,
  onFromDateChange,
  onToDateChange,
  onViewClick,
  onExportExcel,
  onExportPDF,
  loading,
  isRTL
}: SalesReportsDateFilterProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{isRTL ? 'فلترة التاريخ' : 'Date Filter'}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className={cn("flex gap-4 items-end", isRTL ? "flex-row-reverse" : "")}>
          <DatePicker
            date={fromDate}
            onDateChange={onFromDateChange}
            label={isRTL ? 'من تاريخ' : 'From Date'}
            placeholder={isRTL ? 'اختر التاريخ' : 'Pick a date'}
            isRTL={isRTL}
          />
          <DatePicker
            date={toDate}
            onDateChange={onToDateChange}
            label={isRTL ? 'إلى تاريخ' : 'To Date'}
            placeholder={isRTL ? 'اختر التاريخ' : 'Pick a date'}
            isRTL={isRTL}
          />
          <Button onClick={onViewClick} disabled={loading || !fromDate || !toDate}>
            {isRTL ? 'عرض' : 'View'}
          </Button>
          <Button variant="outline" onClick={onExportExcel} disabled={loading}>
            <Download className="h-4 w-4 mr-2" />
            Excel
          </Button>
          <Button variant="outline" onClick={onExportPDF} disabled={loading}>
            <Download className="h-4 w-4 mr-2" />
            PDF
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

