import { useState, useEffect } from 'react';
import i18next from 'i18next';
import { toast } from 'sonner';
import { supabase, getTenantId } from '@/lib/supabase';
import { fetchTrialBalanceRpc } from '@/services/accounting/trial-balance-rpc';
import { PerformanceMonitor } from '@/lib/performance-monitor';
import type { TrialBalanceRow } from '../types';

export function useTrialBalance(fromDate: string, asOfDate: string) {
  const [balances, setBalances] = useState<TrialBalanceRow[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchTrialBalance = async () => {
    await PerformanceMonitor.measure('Trial Balance Page Load', async () => {
      setLoading(true);
      try {
        console.log('🔍 Fetching trial balance from:', fromDate, 'to:', asOfDate);

        const orgId = await getTenantId();
        const rows = await fetchTrialBalanceRpc(supabase, orgId, asOfDate);
        setBalances(rows);
      } catch (error) {
        console.error('❌ Trial balance RPC failed:', error);
        toast.error(i18next.t('accounting.trialBalance.fetchError'));
        setBalances([]);
      } finally {
        setLoading(false);
      }
    });
  };

  useEffect(() => {
    fetchTrialBalance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromDate, asOfDate]);

  return {
    balances,
    loading,
    fetchTrialBalance
  };
}
