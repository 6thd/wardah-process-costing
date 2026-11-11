/**
 * Equivalent Units Dashboard — #260 interim honest state.
 *
 * The previous dashboard rendered hard-coded orders (`MO-2023-*`) and static equivalent-unit and cost-per-unit figures,
 * and its two actions ("Calculate EU", "Analyze Variances") called local stubs that returned success and showed a success
 * toast without calculating, analyzing or saving anything (#260, follow-up of 2026-09-29).
 *
 * The SQL engine behind this page (`upsert_stage_cost` / `upsert_stage_cost_core`, `rpc_cost_of_production_report`)
 * cannot run on the current schema, and its repair depends on open owner decisions (D-LAB/D-OH, D-STAGE). Until that
 * DB-first repair lands, the page states that the calculation is unavailable, shows no figures, and offers no action.
 */
import { useTranslation } from 'react-i18next'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { AlertTriangle } from 'lucide-react'

export function EquivalentUnitsDashboard() {
  const { t } = useTranslation()

  return (
    <Alert data-testid="equivalent-units-unavailable" role="status">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>{t('manufacturing.equivalentUnitsPage.unavailable.title')}</AlertTitle>
      <AlertDescription>
        <p>{t('manufacturing.equivalentUnitsPage.unavailable.body')}</p>
        <p>{t('manufacturing.equivalentUnitsPage.unavailable.next')}</p>
      </AlertDescription>
    </Alert>
  )
}
