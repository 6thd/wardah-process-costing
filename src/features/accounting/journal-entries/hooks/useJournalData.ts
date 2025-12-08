import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

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

export function useJournalData(isRTL: boolean) {
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
        toast.error(isRTL ? 'لم يتم العثور على أنواع قيود. يرجى إنشاؤها أولاً.' : 'No journal types found. Please create them first.');
      }

      setJournals(data || []);
    } catch (error: any) {
      console.error('❌ Error fetching journals:', error);
      toast.error(isRTL ? 'خطأ في تحميل أنواع القيود' : 'Error loading journal types');
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
    fetchJournals();
    fetchAccounts();
  }, []);

  return {
    journals,
    accounts,
    fetchJournals,
    fetchAccounts
  };
}

