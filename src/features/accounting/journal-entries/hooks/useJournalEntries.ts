import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { PerformanceMonitor } from '@/lib/performance-monitor';
import type { JournalEntry } from '../types';

interface UseJournalEntriesProps {
  statusFilter: string;
  dateFilter: string;
  journals: any[];
}

export function useJournalEntries({ statusFilter, dateFilter, journals }: UseJournalEntriesProps) {
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

        if (error) {
          console.warn('gl_entries not found, trying journal_entries:', error);
          const entriesWithJournalNames = await fetchFromOldTable(statusFilter, dateFilter, journals);
          setEntries(entriesWithJournalNames);
        } else {
          console.log('✅ Loaded from gl_entries:', data);
          setEntries(data || []);
        }
      } catch (error) {
        console.error('Error fetching entries:', error);
      } finally {
        setLoading(false);
      }
    });
  };

  const fetchFromOldTable = async (statusFilter: string, dateFilter: string, journals: any[]) => {
    let oldQuery = supabase
      .from('journal_entries')
      .select('*')
      .order('entry_date', { ascending: false })
      .order('entry_number', { ascending: false });

    if (statusFilter !== 'all') {
      oldQuery = oldQuery.eq('status', statusFilter);
    }

    if (dateFilter) {
      oldQuery = oldQuery.gte('entry_date', dateFilter);
    }

    const { data: oldData, error: oldError } = await oldQuery;

    if (oldError) throw oldError;

    const entriesWithJournalNames = await Promise.all((oldData || []).map(async (entry) => {
      if (entry.journal_id && journals.length > 0) {
        const journal = journals.find(j => j.id === entry.journal_id);
        return {
          ...entry,
          journal_name: journal?.name || 'General Journal',
          journal_name_ar: journal?.name_ar || 'قيد عام'
        };
      }
      return {
        ...entry,
        journal_name: 'General Journal',
        journal_name_ar: 'قيد عام'
      };
    }));

    return entriesWithJournalNames;
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

