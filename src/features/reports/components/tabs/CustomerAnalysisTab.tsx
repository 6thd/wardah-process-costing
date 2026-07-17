import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { CustomerSalesAnalysis } from '@/services/sales-reports-service';
import { renderLoadingState, renderEmptyState } from '../utils/renderHelpers';
import { CustomerAnalysisTable } from './CustomerAnalysisTable';

interface CustomerAnalysisTabProps {
  readonly loading: boolean;
  readonly customerAnalysis: CustomerSalesAnalysis[];
  readonly isRTL: boolean;
}

export function CustomerAnalysisTab({ loading, customerAnalysis, isRTL }: CustomerAnalysisTabProps) {
  const { t } = useTranslation();
  if (loading) {
    return renderLoadingState();
  }

  if (customerAnalysis.length === 0) {
    return renderEmptyState();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('salesReports.customerAnalysis')}</CardTitle>
      </CardHeader>
      <CardContent>
        <CustomerAnalysisTable customerAnalysis={customerAnalysis} isRTL={isRTL} />
      </CardContent>
    </Card>
  );
}

