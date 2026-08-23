import i18next from 'i18next';
import { supabase, getEffectiveTenantId } from '@/lib/supabase';
import { toast } from 'sonner';
import type { JournalEntry, JournalLine } from '../types';

const t = (key: string) => i18next.t(key);

interface CreateEntryData {
  journal_id: string;
  entry_date: string;
  description?: string;
  description_ar?: string;
  reference_type?: string;
  reference_number?: string;
  total_debit: number;
  total_credit: number;
  lines: Partial<JournalLine>[];
}

interface UpdateEntryData extends CreateEntryData {
  id: string;
}

function toPayload(orgId: string, data: CreateEntryData) {
  return {
    org_id: orgId,
    journal_id: data.journal_id,
    entry_date: data.entry_date,
    description: data.description || null,
    description_ar: data.description_ar || null,
    reference_type: data.reference_type || null,
    reference_number: data.reference_number || null,
    lines: data.lines.map((line, index) => ({
      line_number: index + 1,
      account_id: line.account_id,
      debit: Number(line.debit) || 0,
      credit: Number(line.credit) || 0,
      currency_code: line.currency_code || 'SAR',
      description: line.description || null,
      description_ar: line.description_ar || null,
    })),
  };
}

export async function createJournalEntry(data: CreateEntryData): Promise<string | null> {
  try {
    const orgId = await getEffectiveTenantId();
    if (!orgId) {
      toast.error(t('accounting.journalEntries.svc.orgNotFound'));
      return null;
    }

    const { data: result, error } = await supabase.rpc('rpc_create_manual_journal_entry', {
      p_payload: toPayload(orgId, data),
    });
    if (error) throw error;
    if (!result?.success || !result?.entry_id) {
      throw new Error('Manual journal RPC returned no entry');
    }

    toast.success(t('accounting.journalEntries.svc.saveSuccess'));
    return result.entry_id as string;
  } catch (error: any) {
    console.error('Error creating entry:', error);
    toast.error(error.message || t('accounting.journalEntries.svc.saveError'));
    return null;
  }
}

export async function updateJournalEntry(data: UpdateEntryData): Promise<boolean> {
  try {
    const orgId = await getEffectiveTenantId();
    if (!orgId) {
      toast.error(t('accounting.journalEntries.svc.orgNotFound'));
      return false;
    }

    const { data: result, error } = await supabase.rpc('rpc_update_manual_journal_entry', {
      p_entry_id: data.id,
      p_payload: toPayload(orgId, data),
    });
    if (error) throw error;
    if (!result?.success) throw new Error('Manual journal update failed');

    toast.success(t('accounting.journalEntries.svc.updateSuccess'));
    return true;
  } catch (error: any) {
    console.error('Error updating entry:', error);
    toast.error(error.message || t('accounting.journalEntries.svc.updateError'));
    return false;
  }
}

export async function postJournalEntry(entry: JournalEntry): Promise<boolean> {
  try {
    const { data: result, error } = await supabase.rpc('rpc_post_manual_journal_entry', {
      p_entry_id: entry.id,
    });
    if (error) throw error;
    if (!result?.success) {
      toast.error(t('accounting.journalEntries.svc.postFailed'));
      return false;
    }

    toast.success(t('accounting.journalEntries.svc.postSuccess'));
    return true;
  } catch (error: any) {
    console.error('Error posting entry:', error);
    toast.error(error.message || t('accounting.journalEntries.svc.postError'));
    return false;
  }
}

export async function deleteJournalEntry(entry: JournalEntry): Promise<boolean> {
  try {
    if (entry.status === 'posted' || entry.status === 'reversed') {
      toast.error(t('accounting.journalEntries.cannotDeletePosted'));
      return false;
    }

    const { data: result, error } = await supabase.rpc('rpc_delete_manual_journal_entry', {
      p_entry_id: entry.id,
    });
    if (error) throw error;
    if (!result?.success) throw new Error('Manual journal delete failed');

    toast.success(t('accounting.journalEntries.svc.deleteSuccess'));
    return true;
  } catch (error: any) {
    console.error('Error deleting entry:', error);
    toast.error(error.message || t('accounting.journalEntries.svc.deleteError'));
    return false;
  }
}
