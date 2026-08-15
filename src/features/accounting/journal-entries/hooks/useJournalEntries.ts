import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { PerformanceMonitor } from '@/lib/performance-monitor';
import { usePermissions } from '@/hooks/usePermissions';
import type { JournalEntry } from '../types';

interface UseJournalEntriesProps {
  statusFilter: string;
  dateFilter: string;
}

export function useJournalEntries({ statusFilter, dateFilter }: UseJournalEntriesProps) {
  const { hasPermissionKey } = usePermissions();
  // فحص دفاعي على مستوى المكوّن، لا اتكالًا فقط على بوابة الموجّه
  // (accounting.journals.read مفروضة أصلًا عند دخول /accounting/journal-entries).
  const canRead = hasPermissionKey('accounting.journals.read');
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchEntries = async () => {
    if (!canRead) {
      setEntries([]);
      return;
    }
    await PerformanceMonitor.measure('Journal Entries List', async () => {
      setLoading(true);
      try {
        let query = supabase
          .from('gl_entries')
          .select('*')
          .order('entry_date', { ascending: false })
          .order('entry_number', { ascending: false });

        if (statusFilter !== 'all') {
          query = query.eq('status', statusFilter);
        }

        if (dateFilter) {
          query = query.gte('entry_date', dateFilter);
        }

        const { data, error } = await query;
        if (error) throw error;
        setEntries((data || []) as unknown as JournalEntry[]);
      } catch (error) {
        console.error('Error fetching entries:', error);
      } finally {
        setLoading(false);
      }
    });
  };

  useEffect(() => {
    fetchEntries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, dateFilter, canRead]);

  return {
    entries,
    loading,
    fetchEntries
  };
}

