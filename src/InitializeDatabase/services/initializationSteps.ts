import type { SupabaseClient } from '@supabase/supabase-js';

export interface InitializationResult {
  step: string;
  status: 'started' | 'completed' | 'failed';
  error?: string;
  message?: string;
}

const DEFAULT_ORG_ID = '00000000-0000-0000-0000-000000000001';

export async function createDefaultOrganization(
  client: SupabaseClient,
  results: InitializationResult[]
): Promise<void> {
  results.push({ step: 'Creating default organization', status: 'started' });
  const { error: orgError } = await client.from('organizations').upsert({
    id: DEFAULT_ORG_ID,
    name: 'Wardah Factory',
    code: 'WARD'
  }, { onConflict: 'id' });
  
  if (orgError) {
    results.push({ step: 'Creating default organization', status: 'failed', error: orgError.message });
  } else {
    results.push({ step: 'Creating default organization', status: 'completed' });
  }
}

export async function associateUsersWithOrganization(
  client: SupabaseClient,
  results: InitializationResult[]
): Promise<void> {
  results.push({ step: 'Associating users with organization', status: 'started' });
  const { data: authUsers, error: authUsersError } = await client.rpc('auth.users').select('*');
  
  if (!authUsersError && authUsers && authUsers.length > 0) {
    for (const user of authUsers) {
      await createUserProfile(client, user, results);
      await associateUserWithOrg(client, user, results);
    }
  }
}

async function createUserProfile(
  client: SupabaseClient,
  user: any,
  results: InitializationResult[]
): Promise<void> {
  const { error: userError } = await client.from('users').upsert({
    id: user.id,
    email: user.email,
    full_name: user.email?.split('@')[0] || 'User',
    role: 'admin',
    tenant_id: DEFAULT_ORG_ID
  }, { onConflict: 'id' });
  
  if (userError) {
    results.push({ step: `Creating user profile for ${user.email}`, status: 'failed', error: userError.message });
  } else {
    results.push({ step: `Creating user profile for ${user.email}`, status: 'completed' });
  }
}

async function associateUserWithOrg(
  client: SupabaseClient,
  user: any,
  results: InitializationResult[]
): Promise<void> {
  const { error: userOrgError } = await client.from('user_organizations').upsert({
    user_id: user.id,
    org_id: DEFAULT_ORG_ID,
    role: 'admin'
  }, { onConflict: 'user_id,org_id' });
  
  if (userOrgError) {
    results.push({ step: `Associating ${user.email} with organization`, status: 'failed', error: userOrgError.message });
  } else {
    results.push({ step: `Associating ${user.email} with organization`, status: 'completed' });
  }
}

export async function createSampleGLAccounts(
  client: SupabaseClient,
  results: InitializationResult[]
): Promise<void> {
  results.push({ step: 'Checking GL accounts', status: 'started' });
  const { count: accountsCount, error: countError } = await client.from('gl_accounts')
    .select('*', { count: 'exact', head: true });
  
  if (!countError && (accountsCount === 0 || accountsCount === null)) {
    results.push({ step: 'Creating sample GL accounts', status: 'started' });
    
    const sampleAccounts = getSampleAccounts();
    const { error: insertError } = await client.from('gl_accounts').insert(sampleAccounts);
    
    if (insertError) {
      results.push({ step: 'Creating sample GL accounts', status: 'failed', error: insertError.message });
    } else {
      results.push({ step: 'Creating sample GL accounts', status: 'completed' });
    }
  } else {
    results.push({ step: 'Checking GL accounts', status: 'completed', message: `Found ${accountsCount} existing accounts` });
  }
}

function getSampleAccounts() {
  return [
    {
      id: '10000000-0000-0000-0000-000000000001',
      org_id: '00000000-0000-0000-0000-000000000001',
      code: '100000',
      name: 'الأصول',
      category: 'ASSET',
      subtype: 'OTHER',
      normal_balance: 'DEBIT',
      allow_posting: false,
      is_active: true,
      currency: 'SAR'
    },
    {
      id: '10000000-0000-0000-0000-000000000002',
      org_id: '00000000-0000-0000-0000-000000000001',
      code: '110000',
      name: 'الأصول المتداولة',
      category: 'ASSET',
      subtype: 'OTHER',
      parent_code: '100000',
      normal_balance: 'DEBIT',
      allow_posting: false,
      is_active: true,
      currency: 'SAR'
    },
    {
      id: '10000000-0000-0000-0000-000000000003',
      org_id: '00000000-0000-0000-0000-000000000001',
      code: '110100',
      name: 'النقدية في الخزينة',
      category: 'ASSET',
      subtype: 'CASH',
      parent_code: '110000',
      normal_balance: 'DEBIT',
      allow_posting: true,
      is_active: true,
      currency: 'SAR'
    },
    {
      id: '10000000-0000-0000-0000-000000000004',
      org_id: '00000000-0000-0000-0000-000000000001',
      code: '200000',
      name: 'الخصوم',
      category: 'LIABILITY',
      subtype: 'OTHER',
      normal_balance: 'CREDIT',
      allow_posting: false,
      is_active: true,
      currency: 'SAR'
    },
    {
      id: '10000000-0000-0000-0000-000000000005',
      org_id: '00000000-0000-0000-0000-000000000001',
      code: '300000',
      name: 'حقوق الملكية',
      category: 'EQUITY',
      subtype: 'OTHER',
      normal_balance: 'CREDIT',
      allow_posting: false,
      is_active: true,
      currency: 'SAR'
    },
    {
      id: '10000000-0000-0000-0000-000000000006',
      org_id: '00000000-0000-0000-0000-000000000001',
      code: '400000',
      name: 'الإيرادات',
      category: 'REVENUE',
      subtype: 'OTHER',
      normal_balance: 'CREDIT',
      allow_posting: true,
      is_active: true,
      currency: 'SAR'
    },
    {
      id: '10000000-0000-0000-0000-000000000007',
      org_id: '00000000-0000-0000-0000-000000000001',
      code: '500000',
      name: 'المصروفات',
      category: 'EXPENSE',
      subtype: 'OTHER',
      normal_balance: 'DEBIT',
      allow_posting: true,
      is_active: true,
      currency: 'SAR'
    }
  ];
}

