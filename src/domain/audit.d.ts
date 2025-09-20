// Type declarations for audit.js

export interface AuditOperation {
  operation: string
  moId: string
  stageNo: number
  details: Record<string, any>
  newValues: Record<string, any>
}

export function logProcessCostingOperation(operation: AuditOperation): Promise<void>