import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { usePermissions } from '@/hooks/usePermissions';

interface Journal {
  id: string;
  code: string;
  name: string;
  name_ar?: string;
  journal_type: string;
  sequence_prefix: string;
  is_active: boolean;
}

interface Account {
  id: string;
  code: string;
  name: string;
  name_ar?: string;
  name_en?: string;
  category?: string;
  allow_posting?: boolean;
  is_active: boolean;
}

export function useJournalData() {
  const { t } = useTranslation();
  const { hasPermissionKey } = usePermissions();
  // journals هنا بيانات مرجعية (أنواع القيود) تابعة لمورد journal-entries
  // نفسه، فتُحكَم بنفس accounting.journals.read الذي يحكم دخول الشاشة —
  // فحص دفاعي إضافي هنا، لا اتكالًا فقط على بوابة الموجّه. gl_accounts مورد
  // مختلف تمامًا (شجرة الحسابات) فيحتاج accounting.accounts.read الحقيقي.
  const canReadJournals = hasPermissionKey('accounting.journals.read');
  const canReadAccounts = hasPermissionKey('accounting.accounts.read');
  const [journals, setJournals] = useState<Journal[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);

  const fetchJournals = async () => {
    try {
      console.log('🔍 Fetching journals...');
      const { data, error } = await supabase
        .from('journals')
        .select('*')
        .eq('is_active', true)
        .order('code');

      if (error) {
        console.error('❌ Error fetching journals:', error);
        throw error;
      }

      console.log('✅ Loaded journals:', data);

      if (!data || data.length === 0) {
        console.warn('⚠️ No journals found in database');
        toast.error(t('accounting.journalEntries.svc.noJournalTypes'));
      }

      setJournals(data || []);
    } catch (error: any) {
      console.error('❌ Error fetching journals:', error);
      toast.error(t('accounting.journalEntries.svc.loadJournalTypesError'));
    }
  };

  const fetchAccounts = async () => {
    try {
      const { data, error } = await supabase
        .from('gl_accounts')
        .select('*')
        .eq('allow_posting', true)
        .eq('is_active', true)
        .order('code');

      if (error) throw error;
      setAccounts(data || []);
    } catch (error) {
      console.error('Error fetching accounts:', error);
    }
  };

  useEffect(() => {
    if (canReadJournals) {
      fetchJournals();
    } else {
      setJournals([]);
    }
    if (canReadAccounts) {
      fetchAccounts();
    } else {
      setAccounts([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canReadJournals, canReadAccounts]);

  return {
    journals,
    accounts,
    fetchJournals,
    fetchAccounts
  };
}

