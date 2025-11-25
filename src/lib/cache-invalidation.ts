// src/lib/cache-invalidation.ts
// Cache Invalidation Helpers
// مساعدات إبطال الـ Cache

import { QueryClient } from '@tanstack/react-query';

/**
 * Invalidate all caches related to accounting
 */
export const invalidateAccountingCaches = (queryClient: QueryClient) => {
  queryClient.invalidateQueries({ queryKey: ['trial-balance'] });
  queryClient.invalidateQueries({ queryKey: ['journal-entries'] });
  queryClient.invalidateQueries({ queryKey: ['gl-entries'] });
  queryClient.invalidateQueries({ queryKey: ['gl-accounts'] });
  console.log('✅ Invalidated accounting caches');
};

/**
 * Invalidate trial balance cache
 * Use after posting journal entries
 */
export const invalidateTrialBalanceCache = (queryClient: QueryClient) => {
  queryClient.invalidateQueries({ queryKey: ['trial-balance'] });
  console.log('✅ Invalidated trial balance cache');
};

/**
 * Invalidate manufacturing caches
 */
export const invalidateManufacturingCaches = (queryClient: QueryClient) => {
  queryClient.invalidateQueries({ queryKey: ['manufacturing-orders'] });
  queryClient.invalidateQueries({ queryKey: ['work-centers'] });
  queryClient.invalidateQueries({ queryKey: ['stage-costs'] });
  console.log('✅ Invalidated manufacturing caches');
};

/**
 * Invalidate specific manufacturing order cache
 */
export const invalidateManufacturingOrder = (queryClient: QueryClient, orderId: string) => {
  queryClient.invalidateQueries({ queryKey: ['manufacturing-order', orderId] });
  queryClient.invalidateQueries({ queryKey: ['manufacturing-orders'] });
  console.log(`✅ Invalidated manufacturing order: ${orderId}`);
};

/**
 * Clear all caches (use sparingly!)
 */
export const clearAllCaches = (queryClient: QueryClient) => {
  queryClient.clear();
  console.log('🗑️ Cleared all caches');
};

/**
 * Get cache statistics
 */
export const getCacheStats = (queryClient: QueryClient) => {
  const cache = queryClient.getQueryCache();
  const queries = cache.getAll();
  
  const stats = {
    totalQueries: queries.length,
    staleQueries: queries.filter(q => q.isStale()).length,
    fetchingQueries: queries.filter(q => q.state.fetchStatus === 'fetching').length,
    cachedQueries: queries.filter(q => q.state.data !== undefined).length,
  };
  
  console.table(stats);
  return stats;
};

/**
 * Example usage in a mutation:
 * 
 * const postJournalEntry = useMutation({
 *   mutationFn: async (entry) => {
 *     return await journalService.postEntry(entry);
 *   },
 *   onSuccess: () => {
 *     invalidateTrialBalanceCache(queryClient);
 *     invalidateAccountingCaches(queryClient);
 *   }
 * });
 */

