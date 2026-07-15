import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { PerformanceMonitor } from '@/lib/performance-monitor';
import type { JournalEntry } from '../types';

interface UseJournalEntriesProps {
  statusFilter: string;
  dateFilter: string;
}

export function useJournalEntries({ statusFilter, dateFilter }: UseJournalEntriesProps) {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchEntries = async () => {
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
  }, [statusFilter, dateFilter]);

  return {
    entries,
    loading,
    fetchEntries
  };
}

