
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

// ⚠️ SECURITY: Load Supabase configuration from environment variables
// Never hardcode API keys in source code!
// Note: This script uses SERVICE_KEY for admin operations
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ ERROR: Missing Supabase configuration!');
  console.error('Please set SUPABASE_URL and SUPABASE_SERVICE_KEY in your .env file');
  console.error('See .env.example for reference');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function runDiagnostic() {
  console.log('🚀 Running comprehensive diagnostic script...');

  try {
    // 1. Check total count of accounts
    const { count: totalAccounts, error: totalError } = await supabase
      .from('gl_accounts')
      .select('* ', { count: 'exact' });
    if (totalError) console.error('Error getting total accounts:', totalError.message);
    else console.log(`1. Total accounts: ${totalAccounts}`);

    // 2. Check accounts with org_id
    const { count: withOrgId, error: withOrgIdError } = await supabase
      .from('gl_accounts')
      .select('id', { count: 'exact' })
      .not('org_id', 'is', null);
    if (withOrgIdError) console.error('Error getting accounts with org_id:', withOrgIdError.message);
    else console.log(`2. Accounts with org_id: ${withOrgId}`);

    // 3. Check accounts with default org_id
    const { count: withDefaultOrgId, error: withDefaultOrgIdError } = await supabase
      .from('gl_accounts')
      .select('id', { count: 'exact' })
      .eq('org_id', '00000000-0000-0000-0000-000000000001');
    if (withDefaultOrgIdError) console.error('Error getting accounts with default org_id:', withDefaultOrgIdError.message);
    else console.log(`3. Accounts with default org_id: ${withDefaultOrgId}`);

    // 4. Check accounts with NULL org_id
    const { count: withNullOrgId, error: withNullOrgIdError } = await supabase
      .from('gl_accounts')
      .select('id', { count: 'exact' })
      .is('org_id', null);
    if (withNullOrgIdError) console.error('Error getting accounts with NULL org_id:', withNullOrgIdError.message);
    else console.log(`4. Accounts with NULL org_id: ${withNullOrgId}`);

    // 5. Check distinct org_id values
    const { data: distinctOrgIds, error: distinctOrgIdsError } = await supabase
      .from('gl_accounts')
      .select('org_id');
    if (distinctOrgIdsError) console.error('Error getting distinct org_id values:', distinctOrgIdsError.message);
    else {
      const distinctIds = [...new Set(distinctOrgIds.map(a => a.org_id))];
      console.log(`5. Distinct org_id values: ${distinctIds.length}`);
      console.log(distinctIds);
    }

    // 6. Show sample of accounts with their org_id values
    const { data: sampleAccounts, error: sampleAccountsError } = await supabase
      .from('gl_accounts')
      .select('id, code, name, org_id')
      .order('code')
      .limit(20);
    if (sampleAccountsError) console.error('Error getting sample accounts:', sampleAccountsError.message);
    else {
      console.log('\n6. Sample of accounts with their org_id values:');
      console.table(sampleAccounts);
    }

    // 7. Check for any potential issues with parent_code references
    const { data: allCodesData, error: allCodesError } = await supabase
      .from('gl_accounts')
      .select('code')
      .not('code', 'is', null);
    if (allCodesError) {
      console.error('Error getting all account codes:', allCodesError.message);
    } else {
      const allCodes = allCodesData.map(c => c.code);
      const { data: invalidParentAccounts, error: invalidParentError } = await supabase
        .from('gl_accounts')
        .select('id, code, parent_code')
        .not('parent_code', 'is', null)
        .not('parent_code', 'eq', '')
        .not('parent_code', 'in', `(${allCodes.map(c => `'${c}'`).join(',')})`);

      if (invalidParentError) console.error('Error checking for invalid parent_code references:', invalidParentError.message);
      else console.log(`\n7. Accounts with invalid parent_code: ${invalidParentAccounts.length}`);
	  if (invalidParentAccounts.length > 0) {
		  console.table(invalidParentAccounts)
	  }
    }

  } catch (error) {
    console.error('An unexpected error occurred:', error.message);
  }
}

runDiagnostic();
