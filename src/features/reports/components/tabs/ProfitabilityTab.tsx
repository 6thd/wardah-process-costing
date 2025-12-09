import type { ProfitabilityAnalysis } from '@/services/sales-reports-service';
import { renderLoadingState, renderEmptyState } from '../utils/renderHelpers';
import { ProfitabilityMetrics } from './ProfitabilityMetrics';
import { ProfitabilityTables } from './ProfitabilityTables';

interface ProfitabilityTabProps {
  readonly loading: boolean;
  readonly profitability: ProfitabilityAnalysis | null;
  readonly isRTL: boolean;
}

export function ProfitabilityTab({ loading, profitability, isRTL }: ProfitabilityTabProps) {
  if (loading) {
    return renderLoadingState(isRTL);
  }

  if (!profitability) {
    return renderEmptyState(isRTL);
  }

  return (
    <div className="space-y-4">
      <ProfitabilityMetrics profitability={profitability} isRTL={isRTL} />
      <ProfitabilityTables profitability={profitability} isRTL={isRTL} />
    </div>
  );
}

