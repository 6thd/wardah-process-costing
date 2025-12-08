import type { JournalLine, Account } from '../types';

export function normalizeLines(rawLines: any[], entryId: string | undefined, accounts: Account[]): JournalLine[] {
  if (!rawLines || rawLines.length === 0) return [];
  
  return rawLines.map((line, index) => {
    const accountById = line.account_id
      ? accounts.find(a => a.id === line.account_id)
      : undefined;

    const accountByCode = !accountById && line.account_code
      ? accounts.find(a => a.code === line.account_code)
      : undefined;

    const resolvedAccount = accountById || accountByCode;

    return {
      ...line,
      id: line.id || (entryId ? `${entryId}-${index}` : `${index}`),
      line_number: line.line_number || index + 1,
      account_id: resolvedAccount?.id || line.account_id || '',
      account_code: resolvedAccount?.code || line.account_code || '',
      account_name: resolvedAccount?.name || line.account_name || '',
      account_name_ar: resolvedAccount?.name_ar || line.account_name_ar || line.account_name || '',
      debit: line.debit ?? '',
      credit: line.credit ?? '',
      description: line.description || '',
      description_ar: line.description_ar || '',
      currency_code: line.currency_code || 'SAR'
    };
  });
}

export function calculateTotals(lines: Partial<JournalLine>[]): { totalDebit: number; totalCredit: number; balanced: boolean } {
  const totalDebit = lines.reduce((sum, line) => sum + (Number(line.debit) || 0), 0);
  const totalCredit = lines.reduce((sum, line) => sum + (Number(line.credit) || 0), 0);
  return { 
    totalDebit, 
    totalCredit, 
    balanced: totalDebit === totalCredit && totalDebit > 0 
  };
}

export function validateEntry(
  journalId: string,
  lines: Partial<JournalLine>[],
  isRTL: boolean
): { valid: boolean; message?: string } {
  if (!journalId) {
    return {
      valid: false,
      message: isRTL ? 'يجب اختيار نوع القيد' : 'Please select a journal type'
    };
  }

  if (lines.length === 0) {
    return {
      valid: false,
      message: isRTL ? 'يجب إضافة بنود للقيد' : 'Please add lines to the entry'
    };
  }

  const { balanced } = calculateTotals(lines);
  if (!balanced) {
    return {
      valid: false,
      message: isRTL ? 'القيد غير متوازن! يجب تساوي المدين والدائن' : 'Entry not balanced! Debit and Credit must be equal'
    };
  }

  return { valid: true };
}

