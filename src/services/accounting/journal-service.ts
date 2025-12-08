/**
 * Journal Entry Service
 * Enhanced with Batch Posting, Approvals, Attachments, Comments
 */

import { supabase, getEffectiveTenantId } from '@/lib/supabase';

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
  status: 'draft' | 'posted' | 'reversed';
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
  /**
   * Create a journal entry with lines
   */
  static async createEntry(request: CreateJournalEntryRequest): Promise<{
    success: boolean;
    data?: any;
    error?: any;
  }> {
    try {
      const tenantId = await getEffectiveTenantId();
      if (!tenantId) throw new Error('Tenant ID not found');

      // Calculate totals
      const totalDebit = request.lines.reduce((sum, line) => sum + (Number(line.debit) || 0), 0);
      const totalCredit = request.lines.reduce((sum, line) => sum + (Number(line.credit) || 0), 0);

      // Validate balance
      if (Math.abs(totalDebit - totalCredit) > 0.01) {
        throw new Error(`Entry not balanced! Debit: ${totalDebit}, Credit: ${totalCredit}`);
      }

      // Get default journal if not provided
      let journalId = request.journal_id;
      if (!journalId) {
        const { data: defaultJournal } = await supabase
          .from('journals')
          .select('id')
          .eq('org_id', tenantId)
          .eq('is_active', true)
          .order('created_at', { ascending: true })
          .limit(1)
          .single();

        if (defaultJournal) {
          journalId = defaultJournal.id;
        } else {
          throw new Error('No active journal found');
        }
      }

      // Generate entry number
      const { data: entryNumber, error: numberError } = await supabase
        .rpc('generate_entry_number', { p_journal_id: journalId });

      if (numberError) throw numberError;

      // Create entry header
      const entryData = {
        journal_id: journalId,
        entry_number: entryNumber,
        entry_date: request.entry_date,
        entry_type: 'manual',
        description: request.description || null,
        description_ar: request.description_ar || null,
        reference_type: request.reference_type || null,
        reference_number: request.reference_number || null,
        status: 'draft',
        total_debit: totalDebit,
        total_credit: totalCredit,
        org_id: tenantId
      };

      const { data: newEntry, error: entryError } = await supabase
        .from('gl_entries')
        .insert([entryData])
        .select()
        .single();

      if (entryError) throw entryError;

      // Insert lines
      const lines = request.lines.map((line) => ({
        entry_id: newEntry.id,
        line_number: line.line_number,
        account_id: line.account_id,
        debit: Number(line.debit) || 0,
        credit: Number(line.credit) || 0,
        currency_code: line.currency_code || 'SAR',
        description: line.description || null,
        description_ar: line.description_ar || null,
        org_id: tenantId,
        tenant_id: tenantId
      }));

      const { error: linesError } = await supabase
        .from('gl_entry_lines')
        .insert(lines);

      if (linesError) throw linesError;

      return {
        success: true,
        data: { ...newEntry, lines }
      };
    } catch (error: any) {
      console.error('Error creating journal entry:', error);
      return {
        success: false,
        error: error.message || 'Failed to create journal entry'
      };
    }
  }

  /**
   * Post a single journal entry
   */
  static async postJournalEntry(entryId: string): Promise<{
    success: boolean;
    message?: string;
    error?: string;
  }> {
    try {
      const tenantId = await getEffectiveTenantId();
      if (!tenantId) throw new Error('Tenant ID not found');

      // Use batch post with single entry
      const result = await this.batchPostEntries([entryId]);
      
      if (result.success_count > 0) {
        return { success: true, message: 'Entry posted successfully' };
      } else {
        const failedResult = result.results.find(r => r.entry_id === entryId);
        return { 
          success: false, 
          error: failedResult?.error || 'Failed to post entry' 
        };
      }
    } catch (error: any) {
      console.error('Error posting entry:', error);
      return { success: false, error: error.message || 'Failed to post entry' };
    }
  }

  /**
   * Batch Post multiple journal entries
   */
  static async batchPostEntries(entryIds: string[]): Promise<{
    success: boolean;
    total: number;
    success_count: number;
    fail_count: number;
    results: Array<{
      entry_id: string;
      success: boolean;
      message?: string;
      error?: string;
    }>;
  }> {
    try {
      const tenantId = await getEffectiveTenantId();
      if (!tenantId) throw new Error('Tenant ID not found');

      const { data, error } = await supabase.rpc('batch_post_journal_entries', {
        p_entry_ids: entryIds
      });

      if (error) throw error;
      return data;
    } catch (error: any) {
      console.error('Error in batch posting:', error);
      throw new Error(error.message || 'Batch posting failed');
    }
  }

  /**
   * Check if entry requires approval
   */
  static async checkApprovalRequired(entryId: string): Promise<{
    required: boolean;
    required_levels: number;
    current_levels: number;
  }> {
    try {
      const { data, error } = await supabase.rpc('check_entry_approval_required', {
        p_entry_id: entryId
      });

      if (error) throw error;
      return data;
    } catch (error: any) {
      console.error('Error checking approval:', error);
      throw new Error(error.message || 'Failed to check approval');
    }
  }

  /**
   * Approve journal entry at a level
   */
  static async approveEntry(
    entryId: string,
    approvalLevel: number,
    comments?: string
  ): Promise<{
    success: boolean;
    message: string;
    approved_levels: number;
    required_levels: number;
    can_post: boolean;
  }> {
    try {
      const { data, error } = await supabase.rpc('approve_journal_entry', {
        p_entry_id: entryId,
        p_approval_level: approvalLevel,
        p_comments: comments || null
      });

      if (error) throw error;
      return data;
    } catch (error: any) {
      console.error('Error approving entry:', error);
      throw new Error(error.message || 'Approval failed');
    }
  }

  /**
   * Reverse journal entry
   */
  static async reverseEntry(
    entryId: string,
    reversalReason?: string,
    reversalDate?: string
  ): Promise<{
    success: boolean;
    message: string;
    original_entry_id: string;
    reversal_entry_id: string;
    reversal_number: string;
  }> {
    try {
      const { data, error } = await supabase.rpc('reverse_journal_entry_enhanced', {
        p_entry_id: entryId,
        p_reversal_reason: reversalReason || null,
        p_reversal_date: reversalDate || new Date().toISOString().split('T')[0]
      });

      if (error) throw error;
      return data;
    } catch (error: any) {
      console.error('Error reversing entry:', error);
      throw new Error(error.message || 'Reversal failed');
    }
  }

  /**
   * Get entry approvals
   */
  static async getEntryApprovals(entryId: string): Promise<JournalApproval[]> {
    try {
      const { data, error } = await supabase
        .from('journal_entry_approvals')
        .select('*')
        .eq('entry_id', entryId)
        .order('approval_level', { ascending: true });

      if (error) throw error;
      return data || [];
    } catch (error: any) {
      console.error('Error fetching approvals:', error);
      return [];
    }
  }

  /**
   * Get entry attachments
   */
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

  /**
   * Upload attachment
   */
  static async uploadAttachment(
    entryId: string,
    file: File
  ): Promise<JournalAttachment> {
    try {
      const tenantId = await getEffectiveTenantId();
      if (!tenantId) throw new Error('Tenant ID not found');

      // Upload file to storage
      const fileExt = file.name.split('.').pop();
      const fileName = `${entryId}/${Date.now()}.${fileExt}`;
      const filePath = `journal-attachments/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('documents')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      // Save attachment record
      const { data, error } = await supabase
        .from('journal_entry_attachments')
        .insert({
          entry_id: entryId,
          file_name: file.name,
          file_path: filePath,
          file_size: file.size,
          file_type: file.type,
          org_id: tenantId,
          tenant_id: tenantId // Added tenant_id to satisfy constraint
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (error: any) {
      console.error('Error uploading attachment:', error);
      throw new Error(error.message || 'Upload failed');
    }
  }

  /**
   * Delete attachment
   */
  static async deleteAttachment(attachmentId: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('journal_entry_attachments')
        .delete()
        .eq('id', attachmentId);

      if (error) throw error;
    } catch (error: any) {
      console.error('Error deleting attachment:', error);
      throw new Error(error.message || 'Delete failed');
    }
  }

  /**
   * Get entry comments
   */
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

  /**
   * Add comment to entry
   */
  static async addComment(
    entryId: string,
    commentText: string,
    commentType: 'note' | 'comment' | 'internal' = 'comment'
  ): Promise<JournalComment> {
    try {
      const tenantId = await getEffectiveTenantId();
      if (!tenantId) throw new Error('Tenant ID not found');

      const { data, error } = await supabase
        .from('journal_entry_comments')
        .insert({
          entry_id: entryId,
          comment_text: commentText,
          comment_type: commentType,
          tenant_id: tenantId
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (error: any) {
      console.error('Error adding comment:', error);
      throw new Error(error.message || 'Failed to add comment');
    }
  }

  /**
   * Delete comment
   */
  static async deleteComment(commentId: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('journal_entry_comments')
        .delete()
        .eq('id', commentId);

      if (error) throw error;
    } catch (error: any) {
      console.error('Error deleting comment:', error);
      throw new Error(error.message || 'Delete failed');
    }
  }

  /**
   * Fetch entry from database
   */
  private static async fetchEntry(entryId: string): Promise<any> {
    const { data: glData, error: glError } = await supabase
      .from('gl_entries')
      .select('*')
      .eq('id', entryId)
      .single();

    if (glError) throw glError;
    return glData;
  }

  /**
   * Fetch entry lines from database
   */
  private static async fetchEntryLines(entryId: string): Promise<any[]> {
    const { data: glLinesData } = await supabase
      .from('gl_entry_lines')
      .select('*')
      .eq('entry_id', entryId)
      .order('line_number');

    return glLinesData || [];
  }

  /**
   * Enrich lines with account details
   */
  private static async enrichLinesWithAccounts(lines: any[]): Promise<any[]> {
    if (lines.length === 0) return lines;

    const accountIds = lines.map(l => l.account_id).filter(Boolean);
    if (accountIds.length === 0) return lines;

    const { data: accounts } = await supabase
      .from('gl_accounts')
      .select('id, code, name, name_ar')
      .in('id', accountIds);

    if (!accounts) return lines;

    return lines.map(line => {
      const account = accounts.find(a => a.id === line.account_id);
      return {
        ...line,
        account_code: account?.code,
        account_name: account?.name,
        account_name_ar: account?.name_ar
      };
    });
  }

  /**
   * Fetch related data (approvals, attachments, comments)
   */
  private static async fetchEntryRelatedData(entryId: string): Promise<[any[], any[], any[]]> {
    return Promise.all([
      this.getEntryApprovals(entryId).catch(() => []),
      this.getEntryAttachments(entryId).catch(() => []),
      this.getEntryComments(entryId).catch(() => [])
    ]);
  }

  /**
   * Build entry response with all details
   */
  private static buildEntryResponse(entry: any, lines: any[], approvals: any[], attachments: any[], comments: any[]): JournalEntry {
    return {
      ...entry,
      journal_name: entry.journals?.name || entry.journal_name,
      journal_name_ar: entry.journals?.name_ar || entry.journal_name_ar,
      lines: lines.map((line: any) => ({
        ...line,
        account_code: line.gl_accounts?.code || line.account_code,
        account_name: line.gl_accounts?.name || line.account_name,
        account_name_ar: line.gl_accounts?.name_ar || line.account_name_ar
      })),
      approvals: approvals || [],
      attachments: attachments || [],
      comments: comments || []
    };
  }

  /**
   * Get fallback entry (basic info only)
   */
  private static async getFallbackEntry(entryId: string): Promise<JournalEntry | null> {
    try {
      const { data: entry } = await supabase
        .from('journal_entries')
        .select('*')
        .eq('id', entryId)
        .single();

      if (!entry) return null;

      return {
        ...entry,
        lines: [],
        approvals: [],
        attachments: [],
        comments: []
      } as JournalEntry;
    } catch (error: unknown) {
      console.error('Error in journal service:', error);
      return null;
    }
  }

  /**
   * Get full entry with all related data
   */
  static async getEntryWithDetails(entryId: string): Promise<JournalEntry | null> {
    try {
      const entry = await this.fetchEntry(entryId);
      if (!entry) return null;

      const rawLines = await this.fetchEntryLines(entryId);
      const enrichedLines = await this.enrichLinesWithAccounts(rawLines);
      const [approvals, attachments, comments] = await this.fetchEntryRelatedData(entryId);

      return this.buildEntryResponse(entry, enrichedLines, approvals, attachments, comments);
    } catch (error: any) {
      console.error('Error fetching entry details:', error);
      return this.getFallbackEntry(entryId);
    }
  }
}

