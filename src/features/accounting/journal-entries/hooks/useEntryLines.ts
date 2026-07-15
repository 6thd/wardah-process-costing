import { supabase } from '@/lib/supabase';
import { normalizeLines } from '../utils/journalHelpers';
import type { Account, JournalLine } from '../types';

export async function fetchEntryLines(entryId: string, accounts: Account[]): Promise<JournalLine[]> {
  try {
    const { data, error } = await supabase
      .from('gl_entry_lines')
      .select('*')
      .eq('entry_id', entryId)
      .order('line_number');

    if (error) throw error;
    if (!data || data.length === 0) return [];
    return normalizeLines(data, entryId, accounts);
  } catch (error) {
    console.error('Error fetching entry lines:', error);
    return [];
  }
}

