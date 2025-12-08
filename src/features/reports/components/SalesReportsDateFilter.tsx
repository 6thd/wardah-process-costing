import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { CalendarIcon, Download } from 'lucide-react';
import { format } from 'date-fns';
import { arSA, enUS } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface SalesReportsDateFilterProps {
  fromDate: Date | undefined;
  toDate: Date | undefined;
  onFromDateChange: (date: Date | undefined) => void;
  onToDateChange: (date: Date | undefined) => void;
  onViewClick: () => void;
  onExportExcel: () => void;
  onExportPDF: () => void;
  loading: boolean;
  isRTL: boolean;
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
  const locale = isRTL ? arSA : enUS;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{isRTL ? 'فلترة التاريخ' : 'Date Filter'}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className={cn("flex gap-4 items-end", isRTL ? "flex-row-reverse" : "")}>
          <div className="flex-1">
            <Label>{isRTL ? 'من تاريخ' : 'From Date'}</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-normal",
                    !fromDate && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {fromDate ? format(fromDate, 'PPP', { locale }) : <span>{isRTL ? 'اختر التاريخ' : 'Pick a date'}</span>}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align={isRTL ? 'end' : 'start'}>
                <Calendar
                  mode="single"
                  selected={fromDate}
                  onSelect={onFromDateChange}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>
          <div className="flex-1">
            <Label>{isRTL ? 'إلى تاريخ' : 'To Date'}</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-normal",
                    !toDate && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {toDate ? format(toDate, 'PPP', { locale }) : <span>{isRTL ? 'اختر التاريخ' : 'Pick a date'}</span>}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align={isRTL ? 'end' : 'start'}>
                <Calendar
                  mode="single"
                  selected={toDate}
                  onSelect={onToDateChange}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>
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

