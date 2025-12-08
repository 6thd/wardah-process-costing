import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { trialBalanceService } from '@/services/supabase-service';
import { PerformanceMonitor } from '@/lib/performance-monitor';
import type { TrialBalanceRow } from '../types';
import { fetchTrialBalanceManual } from '../services/trialBalanceService';

export function useTrialBalance(fromDate: string, asOfDate: string, isRTL: boolean) {
  const [balances, setBalances] = useState<TrialBalanceRow[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchTrialBalance = async () => {
    await PerformanceMonitor.measure('Trial Balance Page Load', async () => {
      setLoading(true);
      try {
        console.log('🔍 Fetching trial balance from:', fromDate, 'to:', asOfDate);

        try {
          console.log('📊 Calling trialBalanceService.get()...');
          const data = await trialBalanceService.get(fromDate, asOfDate);
          console.log('✅ Loaded from trialBalanceService:', data?.length, 'accounts');

          if (!data || data.length === 0) {
            console.warn('⚠️ No data returned from trialBalanceService');
            throw new Error('No data');
          }

          const formattedData = data.map((account: any) => ({
            account_code: account.account_code,
            account_name: account.account_name || account.account_code,
            account_name_ar: account.account_name_ar || account.account_name || account.account_code,
            account_type: 'ASSET',
            opening_debit: 0,
            opening_credit: 0,
            period_debit: account.debit,
            period_credit: account.credit,
            closing_debit: Math.max(0, account.debit - account.credit),
            closing_credit: Math.max(0, account.credit - account.debit)
          }));

          console.log('✅ Formatted data ready:', formattedData.length, 'accounts');
          setBalances(formattedData);
          return;
        } catch (newError: any) {
          console.warn('⚠️ New service error:', newError?.message || newError);
          console.warn('Trying RPC fallback...');
        }

        const { data, error } = await supabase
          .rpc('rpc_get_trial_balance', {
            p_tenant: '00000000-0000-0000-0000-000000000001',
            p_as_of_date: asOfDate
          });

        if (error) {
          console.error('❌ RPC Error, falling back to manual:', error);
          const manualData = await fetchTrialBalanceManual(fromDate, asOfDate, isRTL);
          setBalances(manualData);
        } else {
          console.log('✅ RPC Data received:', data?.length, 'rows');
          setBalances(data || []);
        }
      } catch (error) {
        console.error('❌ Exception, falling back to manual:', error);
        const manualData = await fetchTrialBalanceManual(fromDate, asOfDate, isRTL);
        setBalances(manualData);
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

