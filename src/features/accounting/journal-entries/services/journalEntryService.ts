import { supabase, getEffectiveTenantId } from '@/lib/supabase';
import { JournalService } from '@/services/accounting/journal-service';
import { toast } from 'sonner';
import type { JournalEntry, JournalLine } from '../types';

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

export async function createJournalEntry(data: CreateEntryData, isRTL: boolean): Promise<string | null> {
  try {
    const tenantId = await getEffectiveTenantId();
    if (!tenantId) {
      toast.error(isRTL ? 'لم يتم تحديد المؤسسة الحالية' : 'Organization context not found');
      return null;
    }

    // Generate entry_number using RPC function
    let entryNumber: string;
    try {
      const { data: numberData, error: numberError } = await supabase
        .rpc('generate_entry_number', { p_journal_id: data.journal_id });
      
      if (numberError) {
        console.warn('Error generating entry number via RPC, using fallback:', numberError);
        // Fallback: generate a simple number based on timestamp
        entryNumber = `JE-${Date.now()}`;
      } else {
        entryNumber = numberData || `JE-${Date.now()}`;
      }
    } catch (error) {
      console.warn('Error generating entry number, using fallback:', error);
      entryNumber = `JE-${Date.now()}`;
    }

    const entryData = {
      journal_id: data.journal_id,
      entry_number: entryNumber,
      entry_date: data.entry_date,
      entry_type: 'manual',
      description: data.description || null,
      description_ar: data.description_ar || null,
      reference_type: data.reference_type || null,
      reference_number: data.reference_number || null,
      status: 'draft',
      total_debit: data.total_debit,
      total_credit: data.total_credit,
      org_id: tenantId
    };

    console.log('💾 Saving entry:', entryData);

    const { data: entry, error: entryError } = await supabase
      .from('gl_entries')
      .insert(entryData)
      .select()
      .single();

    if (entryError) throw entryError;

    const lines = data.lines.map((line, index) => ({
      entry_id: entry.id,
      line_number: index + 1,
      account_id: line.account_id,
      debit: Number(line.debit) || 0,
      credit: Number(line.credit) || 0,
      currency_code: line.currency_code || 'SAR',
      description: line.description,
      description_ar: line.description_ar,
      org_id: tenantId,
      tenant_id: tenantId
    }));

    const { error: linesError } = await supabase
      .from('gl_entry_lines')
      .insert(lines);

    if (linesError) throw linesError;

    toast.success(isRTL ? 'تم حفظ القيد بنجاح' : 'Entry saved successfully');
    return entry.id;
  } catch (error: any) {
    console.error('Error creating entry:', error);
    toast.error(error.message || (isRTL ? 'خطأ في حفظ القيد' : 'Error saving entry'));
    return null;
  }
}

export async function updateJournalEntry(data: UpdateEntryData, isRTL: boolean): Promise<boolean> {
  try {
    const tenantId = await getEffectiveTenantId();
    if (!tenantId) {
      toast.error(isRTL ? 'لم يتم تحديد المؤسسة الحالية' : 'Organization context not found');
      return false;
    }

    const entryData = {
      journal_id: data.journal_id,
      entry_date: data.entry_date,
      description: data.description || null,
      description_ar: data.description_ar || null,
      reference_type: data.reference_type || null,
      reference_number: data.reference_number || null,
      total_debit: data.total_debit,
      total_credit: data.total_credit,
      org_id: tenantId
    };

    const { error: entryError } = await supabase
      .from('gl_entries')
      .update(entryData)
      .eq('id', data.id);

    if (entryError) throw entryError;

    await supabase
      .from('gl_entry_lines')
      .delete()
      .eq('entry_id', data.id);

    const lines = data.lines.map((line, index) => ({
      entry_id: data.id,
      line_number: index + 1,
      account_id: line.account_id,
      debit: Number(line.debit) || 0,
      credit: Number(line.credit) || 0,
      currency_code: line.currency_code || 'SAR',
      description: line.description,
      description_ar: line.description_ar,
      org_id: tenantId,
      tenant_id: tenantId
    }));

    const { error: linesError } = await supabase
      .from('gl_entry_lines')
      .insert(lines);

    if (linesError) throw linesError;

    toast.success(isRTL ? 'تم تحديث القيد بنجاح' : 'Entry updated successfully');
    return true;
  } catch (error: any) {
    console.error('Error updating entry:', error);
    toast.error(error.message || (isRTL ? 'خطأ في تحديث القيد' : 'Error updating entry'));
    return false;
  }
}

export async function postJournalEntry(entry: JournalEntry, isRTL: boolean): Promise<boolean> {
  try {
    const result = await JournalService.postJournalEntry(entry.id);
    if (result.success) {
      toast.success(isRTL ? 'تم ترحيل القيد بنجاح' : 'Entry posted successfully');
      return true;
    }
    toast.error(result.error || (isRTL ? 'فشل ترحيل القيد' : 'Failed to post entry'));
    return false;
  } catch (error: any) {
    console.error('Error posting entry:', error);
    toast.error(error.message || (isRTL ? 'خطأ في ترحيل القيد' : 'Error posting entry'));
    return false;
  }
}

export async function deleteJournalEntry(entry: JournalEntry, isRTL: boolean): Promise<boolean> {
  try {
    if (entry.status === 'posted') {
      toast.error(isRTL ? 'لا يمكن حذف قيد مرحّل' : 'Cannot delete posted entry');
      return false;
    }

    await supabase
      .from('gl_entry_lines')
      .delete()
      .eq('entry_id', entry.id);

    const { error } = await supabase
      .from('gl_entries')
      .delete()
      .eq('id', entry.id);

    if (error) throw error;

    toast.success(isRTL ? 'تم حذف القيد بنجاح' : 'Entry deleted successfully');
    return true;
  } catch (error: any) {
    console.error('Error deleting entry:', error);
    toast.error(error.message || (isRTL ? 'خطأ في حذف القيد' : 'Error deleting entry'));
    return false;
  }
}

