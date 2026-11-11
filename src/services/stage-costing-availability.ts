/**
 * #260 interim boundary for client-side stage costing (fail closed).
 *
 * The stage-costing writes of `process-costing-service.ts` targeted objects that do not exist on the schema now in
 * Production (observed after M203 on 2026-10-21): `labor_time_logs` and `moh_applied` are absent, and `stage_costs` has
 * `good_qty/scrap_qty/dm_cost/dl_cost/moh_cost/mode` with UNIQUE (org_id, manufacturing_order_id, stage_number) — not
 * the `good_quantity/material_cost/labor_cost/overhead_cost/status/stage_id` columns and conflict key the client wrote.
 * Every call failed at the database, and the unit cost was computed in the client (`totalCost / goodQty`) from a
 * client-supplied material cost.
 *
 * Until the DB-first repair of the costing engine in #260 (owner decisions D-LAB/D-OH on labor and overhead sources and
 * D-STAGE on incremental versus cumulative rows), these operations refuse before any network request and write nothing.
 * They must not be re-enabled by pointing them at other tables or by computing costs in the client.
 *
 * Kept in its own module so that callers can recognise the refusal without importing the service.
 */
export const STAGE_COSTING_UNAVAILABLE_CODE = 'STAGE_COSTING_UNAVAILABLE_PENDING_260'

export type UnavailableStageCostingOperation = 'applyLaborTime' | 'applyOverhead' | 'upsertStageCost'

export class StageCostingUnavailableError extends Error {
  readonly code = STAGE_COSTING_UNAVAILABLE_CODE
  readonly operation: UnavailableStageCostingOperation

  constructor(operation: UnavailableStageCostingOperation) {
    super(
      `${STAGE_COSTING_UNAVAILABLE_CODE}: ${operation} — احتساب تكاليف المراحل وتسجيل العمل والتكاليف غير المباشرة ` +
        'معطّل مؤقتًا حتى إصلاح محرك التكلفة في قاعدة البيانات (#260). لم يُرسل أي طلب ولم يُكتب شيء.'
    )
    this.name = 'StageCostingUnavailableError'
    this.operation = operation
  }
}

export function isStageCostingUnavailable(error: unknown): error is StageCostingUnavailableError {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === STAGE_COSTING_UNAVAILABLE_CODE
  )
}
