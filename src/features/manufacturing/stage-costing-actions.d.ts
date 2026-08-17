// Type declarations for stage-costing-actions.js

export function buildUpsertStageCostPayload(formData: { get(key: string): string | null }): {
  moId: string | null
  stageId: string | null
  stageNo: number | null
  workCenterId: string | null
  goodQty: number
  directMaterialCost: number
  mode: string
  scrapQty: number
  reworkQty: number
  notes: string | null
}
export function registerStageCostingActions(): void
export function unregisterStageCostingActions(): void
export function escapeHtml(value: unknown): string
export function generateStageCostReport(
  moId: string,
  stageCosts: unknown[],
  deps?: {
    manufacturing?: { getManufacturingOrderById: (moId: string) => Promise<{ success: boolean; data: unknown } | null> }
    openWindow?: (url: string, target: string, features: string) => { document: { write: (html: string) => void; close: () => void } }
  }
): Promise<void>