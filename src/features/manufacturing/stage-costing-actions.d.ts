// Type declarations for stage-costing-actions.js

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