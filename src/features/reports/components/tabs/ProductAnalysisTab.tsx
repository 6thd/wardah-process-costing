import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ProductSalesAnalysis } from '@/services/sales-reports-service';
import { renderLoadingState, renderEmptyState } from '../utils/renderHelpers';
import { ProductAnalysisTable } from './ProductAnalysisTable';

interface ProductAnalysisTabProps {
  readonly loading: boolean;
  readonly productAnalysis: ProductSalesAnalysis[];
  readonly isRTL: boolean;
}

export function ProductAnalysisTab({ loading, productAnalysis, isRTL }: ProductAnalysisTabProps) {
  const { t } = useTranslation();
  if (loading) {
    return renderLoadingState();
  }

  if (productAnalysis.length === 0) {
    return renderEmptyState();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('salesReports.productAnalysis')}</CardTitle>
      </CardHeader>
      <CardContent>
        <ProductAnalysisTable productAnalysis={productAnalysis} isRTL={isRTL} />
      </CardContent>
    </Card>
  );
}

