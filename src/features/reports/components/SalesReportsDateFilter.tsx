import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('salesReports.dateFilter')}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className={cn("flex gap-4 items-end", isRTL ? "flex-row-reverse" : "")}>
          <DatePicker
            date={fromDate}
            onDateChange={onFromDateChange}
            label={t('salesReports.fromDate')}
            placeholder={t('salesReports.pickDate')}
            isRTL={isRTL}
          />
          <DatePicker
            date={toDate}
            onDateChange={onToDateChange}
            label={t('salesReports.toDate')}
            placeholder={t('salesReports.pickDate')}
            isRTL={isRTL}
          />
          <Button onClick={onViewClick} disabled={loading || !fromDate || !toDate}>
            {t('salesReports.view')}
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

