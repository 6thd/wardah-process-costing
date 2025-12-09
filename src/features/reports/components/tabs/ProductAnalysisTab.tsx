import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ProductSalesAnalysis } from '@/services/sales-reports-service';
import { renderLoadingState, renderEmptyState } from '../utils/renderHelpers';
import { ProductAnalysisTable } from './ProductAnalysisTable';

interface ProductAnalysisTabProps {
  loading: boolean;
  productAnalysis: ProductSalesAnalysis[];
  isRTL: boolean;
}

export function ProductAnalysisTab({ loading, productAnalysis, isRTL }: ProductAnalysisTabProps) {
  if (loading) {
    return renderLoadingState(isRTL);
  }

  if (productAnalysis.length === 0) {
    return renderEmptyState(isRTL);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{isRTL ? 'تحليل المنتجات' : 'Product Analysis'}</CardTitle>
      </CardHeader>
      <CardContent>
        <ProductAnalysisTable productAnalysis={productAnalysis} isRTL={isRTL} />
      </CardContent>
    </Card>
  );
}

