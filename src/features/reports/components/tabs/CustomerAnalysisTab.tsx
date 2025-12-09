import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { CustomerSalesAnalysis } from '@/services/sales-reports-service';
import { renderLoadingState, renderEmptyState } from '../utils/renderHelpers';
import { CustomerAnalysisTable } from './CustomerAnalysisTable';

interface CustomerAnalysisTabProps {
  loading: boolean;
  customerAnalysis: CustomerSalesAnalysis[];
  isRTL: boolean;
}

export function CustomerAnalysisTab({ loading, customerAnalysis, isRTL }: CustomerAnalysisTabProps) {
  if (loading) {
    return renderLoadingState(isRTL);
  }

  if (customerAnalysis.length === 0) {
    return renderEmptyState(isRTL);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{isRTL ? 'تحليل العملاء' : 'Customer Analysis'}</CardTitle>
      </CardHeader>
      <CardContent>
        <CustomerAnalysisTable customerAnalysis={customerAnalysis} isRTL={isRTL} />
      </CardContent>
    </Card>
  );
}

