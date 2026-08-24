/**
 * Journal Entry Service
 * Canonical gl_entries lifecycle after Migration 178.
 */

import { supabase as _supabase, getEffectiveTenantId } from '@/lib/supabase';
const supabase = _supabase as import('@supabase/supabase-js').SupabaseClient

export interface JournalEntry {
  id: string;
  org_id: string;
  journal_id: string;
  entry_number: string;
  entry_date: string;
  posting_date?: string;
  period_id?: string;
  reference_type?: string;
  reference_id?: string;
  reference_number?: string;
  description?: string;
  description_ar?: string;
  status: 'draft' | 'posted' | 'reversed' | 'cancelled';
  posted_at?: string;
  posted_by?: string;
  reversed_by_entry_id?: string;
  reversal_reason?: string;
  total_debit: number;
  total_credit: number;
  created_at: string;
  updated_at: string;
  created_by?: string;
  updated_by?: string;
  journal_name?: string;
  journal_name_ar?: string;
  lines?: JournalLine[];
  approvals?: JournalApproval[];
  attachments?: JournalAttachment[];
  comments?: JournalComment[];
}

export interface JournalLine {
  id?: string;
  entry_id?: string;
  line_number: number;
  account_id: string;
  account_code?: string;
  account_name?: string;
  account_name_ar?: string;
  cost_center_id?: string;
  partner_id?: string;
  product_id?: string;
  project_id?: string;
  debit?: number | string;
  credit?: number | string;
  currency_code: string;
  description?: string;
  description_ar?: string;
  reconciled?: boolean;
  reconciled_at?: string;
  reconciled_by?: string;
  created_at?: string;
}

/**
 * Historical response shape retained for compatibility only.
 * The active Journal UI no longer reads or mutates legacy approval records.
 */
export interface JournalApproval {
  id: string;
  entry_id: string;
  approval_level: number;
  approver_id: string;
  status: 'pending' | 'approved' | 'rejected';
  comments?: string;
  approved_at?: string;
  rejected_at?: string;
  created_at: string;
}

export interface JournalAttachment {
  id: string;
  entry_id: string;
  file_name: string;
  file_path: string;
  file_size?: number;
  file_type?: string;
  uploaded_by?: string;
  created_at: string;
}

export interface JournalComment {
  id: string;
  entry_id: string;
  comment_text: string;
  comment_type: 'note' | 'comment' | 'internal';
  created_by?: string;
  created_at: string;
  updated_at: string;
}

export interface CreateJournalEntryRequest {
  journal_id?: string | null;
  entry_date: string;
  description?: string;
  description_ar?: string;
  reference_type?: string;
  reference_number?: string;
  lines: Array<{
    account_id: string;
    line_number: number;
    debit: number;
    credit: number;
    description?: string;
    description_ar?: string;
    currency_code?: string;
  }>;
}

export class JournalService {
  /** Create a manual journal through the authoritative server boundary. */
  static async createEntry(request: CreateJournalEntryRequest): Promise<{
    success: boolean;
    data?: any;
    error?: any;
  }> {
    try {
      const tenantId = await getEffectiveTenantId();
      if (!tenantId) throw new Error('Tenant ID not found');

      const totalDebit = request.lines.reduce((sum, line) => sum + (Number(line.debit) || 0), 0);
      const totalCredit = request.lines.reduce((sum, line) => sum + (Number(line.credit) || 0), 0);
      if (Math.abs(totalDebit - totalCredit) > 0.01) {
        throw new Error(`Entry not balanced! Debit: ${totalDebit}, Credit: ${totalCredit}`);
      }

      const { data, error } = await supabase.rpc('rpc_create_manual_journal_entry', {
        p_payload: {
          org_id: tenantId,
          journal_id: request.journal_id || null,
          entry_date: request.entry_date,
          description: request.description || null,
          description_ar: request.description_ar || null,
          reference_type: request.reference_type || null,
          reference_number: request.reference_number || null,
          lines: request.lines.map((line) => ({
            line_number: line.line_number,
            account_id: line.account_id,
            debit: Number(line.debit) || 0,
            credit: Number(line.credit) || 0,
            currency_code: line.currency_code || 'SAR',
            description: line.description || null,
            description_ar: line.description_ar || null,
          })),
        },
      });
      if (error) throw error;
      if (!data?.success || !data?.entry_id) throw new Error('Manual journal RPC returned no entry');

      return {
        success: true,
        data: {
          id: data.entry_id,
          entry_number: data.entry_number,
          entry_date: request.entry_date,
          status: data.status || 'draft',
          total_debit: totalDebit,
          total_credit: totalCredit,
          org_id: tenantId,
          lines: request.lines,
        },
      };
    } catch (error: any) {
      console.error('Error creating journal entry:', error);
      return { success: false, error: error.message || 'Failed to create journal entry' };
    }
  }

  static async postJournalEntry(entryId: string): Promise<{
    success: boolean;
    message?: string;
    error?: string;
  }> {
    try {
      const { data, error } = await supabase.rpc('rpc_post_manual_journal_entry', {
        p_entry_id: entryId,
      });
      if (error) throw error;
      if (!data?.success) return { success: false, error: 'Failed to post entry' };
      return { success: true, message: 'Entry posted successfully' };
    } catch (error: any) {
      console.error('Error posting entry:', error);
      return { success: false, error: error.message || 'Failed to post entry' };
    }
  }

  static async batchPostEntries(entryIds: string[]): Promise<{
    success: boolean;
    total: number;
    success_count: number;
    fail_count: number;
    results: Array<{ entry_id: string; success: boolean; message?: string; error?: string }>;
  }> {
    const { data, error } = await supabase.rpc('rpc_batch_post_manual_journal_entries', {
      p_entry_ids: entryIds,
    });
    if (error) throw new Error(error.message || 'Batch posting failed');
    return data;
  }

  static async reverseEntry(
    entryId: string,
    reversalReason?: string,
    reversalDate?: string,
  ): Promise<{
    success: boolean;
    message: string;
    original_entry_id: string;
    reversal_entry_id: string;
    reversal_number: string;
  }> {
    try {
      const { data, error } = await supabase.rpc('rpc_reverse_manual_journal_entry', {
        p_entry_id: entryId,
        p_reversal_reason: reversalReason || null,
        p_reversal_date: reversalDate || new Date().toISOString().split('T')[0],
      });
      if (error) throw error;
      return { ...data, message: data?.duplicate ? 'Entry already reversed' : 'Entry reversed successfully' };
    } catch (error: any) {
      console.error('Error reversing entry:', error);
      throw new Error(error.message || 'Reversal failed');
    }
  }

  static async getEntryAttachments(entryId: string): Promise<JournalAttachment[]> {
    try {
      const { data, error } = await supabase
        .from('journal_entry_attachments')
        .select('*')
        .eq('entry_id', entryId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    } catch (error: any) {
      console.error('Error fetching attachments:', error);
      return [];
    }
  }

  static async uploadAttachment(entryId: string, file: File): Promise<JournalAttachment> {
    const tenantId = await getEffectiveTenantId();
    if (!tenantId) throw new Error('Tenant ID not found');
    const fileExt = file.name.split('.').pop();
    const filePath = `journal-attachments/${entryId}/${Date.now()}.${fileExt}`;
    const { error: uploadError } = await supabase.storage.from('documents').upload(filePath, file);
    if (uploadError) throw uploadError;
    const { data, error } = await supabase
      .from('journal_entry_attachments')
      .insert({
        entry_id: entryId,
        file_name: file.name,
        file_path: filePath,
        file_size: file.size,
        file_type: file.type,
        org_id: tenantId,
        tenant_id: tenantId,
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  static async deleteAttachment(attachmentId: string): Promise<void> {
    const { error } = await supabase.from('journal_entry_attachments').delete().eq('id', attachmentId);
    if (error) throw error;
  }

  static async getEntryComments(entryId: string): Promise<JournalComment[]> {
    try {
      const { data, error } = await supabase
        .from('journal_entry_comments')
        .select('*')
        .eq('entry_id', entryId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    } catch (error: any) {
      console.error('Error fetching comments:', error);
      return [];
    }
  }

  static async addComment(
    entryId: string,
    commentText: string,
    commentType: 'note' | 'comment' | 'internal' = 'comment',
  ): Promise<JournalComment> {
    const tenantId = await getEffectiveTenantId();
    if (!tenantId) throw new Error('Tenant ID not found');
    const { data, error } = await supabase
      .from('journal_entry_comments')
      .insert({ entry_id: entryId, comment_text: commentText, comment_type: commentType, tenant_id: tenantId })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  static async deleteComment(commentId: string): Promise<void> {
    const { error } = await supabase.from('journal_entry_comments').delete().eq('id', commentId);
    if (error) throw error;
  }

  private static async fetchEntry(entryId: string): Promise<any> {
    const { data, error } = await supabase.from('gl_entries').select('*').eq('id', entryId).single();
    if (error) throw error;
    return data;
  }

  private static async fetchEntryLines(entryId: string): Promise<any[]> {
    const { data } = await supabase
      .from('gl_entry_lines')
      .select('*')
      .eq('entry_id', entryId)
      .order('line_number');
    return data || [];
  }

  private static async enrichLinesWithAccounts(lines: any[]): Promise<any[]> {
    if (lines.length === 0) return lines;
    const accountIds = lines.map((line) => line.account_id).filter(Boolean);
    if (accountIds.length === 0) return lines;
    const { data: accounts } = await supabase.from('gl_accounts').select('id, code, name, name_ar').in('id', accountIds);
    if (!accounts) return lines;
    return lines.map((line) => {
      const account = accounts.find((candidate) => candidate.id === line.account_id);
      return {
        ...line,
        account_code: account?.code,
        account_name: account?.name,
        account_name_ar: account?.name_ar,
      };
    });
  }

  private static async fetchEntryRelatedData(entryId: string): Promise<[any[], any[]]> {
    return Promise.all([
      this.getEntryAttachments(entryId).catch(() => []),
      this.getEntryComments(entryId).catch(() => []),
    ]);
  }

  private static buildEntryResponse(
    entry: any,
    lines: any[],
    attachments: any[],
    comments: any[],
  ): JournalEntry {
    return {
      ...entry,
      journal_name: entry.journals?.name || entry.journal_name,
      journal_name_ar: entry.journals?.name_ar || entry.journal_name_ar,
      lines,
      approvals: [],
      attachments: attachments || [],
      comments: comments || [],
    };
  }

  private static async getFallbackEntry(entryId: string): Promise<JournalEntry | null> {
    try {
      const { data } = await supabase.from('gl_entries').select('*').eq('id', entryId).single();
      if (!data) return null;
      return { ...data, lines: [], approvals: [], attachments: [], comments: [] } as JournalEntry;
    } catch {
      return null;
    }
  }

  static async getEntryWithDetails(entryId: string): Promise<JournalEntry | null> {
    try {
      const entry = await this.fetchEntry(entryId);
      if (!entry) return null;
      const rawLines = await this.fetchEntryLines(entryId);
      const lines = await this.enrichLinesWithAccounts(rawLines);
      const [attachments, comments] = await this.fetchEntryRelatedData(entryId);
      return this.buildEntryResponse(entry, lines, attachments, comments);
    } catch (error: any) {
      console.error('Error fetching entry details:', error);
      return this.getFallbackEntry(entryId);
    }
  }
}
