/**
 * Helper functions for Stage WIP Log Service
 * Extracted to reduce cognitive complexity
 */

export interface StageWipFilters {
  moId?: string;
  stageId?: string;
  periodStart?: string;
  periodEnd?: string;
  isClosed?: boolean;
}

/**
 * Apply filters to query
 */
export function applyWipFilters<T>(
  query: T,
  filters: StageWipFilters | undefined,
  tenantId: string | null
): T {
  let filteredQuery = query as { eq: (col: string, val: unknown) => T; gte: (col: string, val: unknown) => T; lte: (col: string, val: unknown) => T };

  if (tenantId) {
    filteredQuery = filteredQuery.eq('org_id', tenantId) as typeof filteredQuery;
  }

  if (filters?.moId) {
    filteredQuery = filteredQuery.eq('mo_id', filters.moId) as typeof filteredQuery;
  }

  if (filters?.stageId) {
    filteredQuery = filteredQuery.eq('stage_id', filters.stageId) as typeof filteredQuery;
  }

  if (filters?.periodStart) {
    filteredQuery = filteredQuery.gte('period_start', filters.periodStart) as typeof filteredQuery;
  }

  if (filters?.periodEnd) {
    filteredQuery = filteredQuery.lte('period_end', filters.periodEnd) as typeof filteredQuery;
  }

  if (filters?.isClosed !== undefined) {
    filteredQuery = filteredQuery.eq('is_closed', filters.isClosed) as typeof filteredQuery;
  }

  return filteredQuery as T;
}
