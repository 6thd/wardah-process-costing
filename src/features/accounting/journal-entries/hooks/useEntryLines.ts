import { supabase } from '@/lib/supabase';
import { normalizeLines } from '../utils/journalHelpers';
import type { Account, JournalLine } from '../types';

export async function fetchEntryLines(entryId: string, accounts: Account[]): Promise<JournalLine[]> {
  try {
    console.log('🔍 Fetching lines for entry:', entryId);
    let lines: any[] = [];

    // 1. Try new gl_entry_lines table first
    const { data: newData, error: newError } = await supabase
      .from('gl_entry_lines')
      .select('*')
      .eq('entry_id', entryId)
      .order('line_number');

    if (!newError && newData && newData.length > 0) {
      console.log('✅ Found lines in gl_entry_lines:', newData);
      lines = newData;
    } else {
      // 2. Fallback to old journal_lines table
      console.log('⚠️ No lines in gl_entry_lines, trying journal_lines...');
      const { data: oldData, error: oldError } = await supabase
        .from('journal_lines')
        .select('*')
        .eq('entry_id', entryId)
        .order('line_number');

      if (!oldError && oldData && oldData.length > 0) {
        console.log('✅ Found lines in journal_lines:', oldData);
        lines = oldData;
      }
    }

    if (lines.length === 0) {
      console.warn('⚠️ No lines found in either table for entry:', entryId);
      return [];
    }

    return normalizeLines(lines, entryId, accounts);
  } catch (error) {
    console.error('Error fetching entry lines:', error);
    return [];
  }
}

