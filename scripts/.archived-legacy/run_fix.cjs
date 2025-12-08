const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

// ⚠️ SECURITY: Load Supabase configuration from environment variables
// Never hardcode API keys in source code!
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('❌ ERROR: Missing Supabase configuration!');
  console.error('Please set SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env file');
  console.error('See .env.example for reference');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function runFix() {
  console.log('🔧 Running tenant ID fix...');
  
  try {
    // Check current state
    console.log('\n1. Checking current tenant_id distribution...');
    const { data: allAccounts, error: allError } = await supabase
      .from('gl_accounts')
      .select('tenant_id');
      
    if (allError) {
      console.log('Error fetching accounts:', allError.message);
    } else {
      // Group by tenant_id manually
      const tenantMap = {};
      allAccounts.forEach(account => {
        const id = account.tenant_id || 'null';
        tenantMap[id] = (tenantMap[id] || 0) + 1;
      });
      console.log('Current tenant distribution:', tenantMap);
    }
    
    // Update all gl_accounts to use a default tenant ID
    console.log('\n2. Updating gl_accounts with default tenant ID...');
    // First, let's get all accounts that don't have the correct tenant ID
    const { data: accountsToUpdate, error: fetchError } = await supabase
      .from('gl_accounts')
      .select('id')
      .neq('tenant_id', '00000000-0000-0000-0000-000000000001');
      
    if (fetchError) {
      console.log('Error fetching accounts to update:', fetchError.message);
      return;
    }
    
    console.log(`Found ${accountsToUpdate.length} accounts to update`);
    
    // Update in batches to avoid stack depth issues
    const batchSize = 50;
    for (let i = 0; i < accountsToUpdate.length; i += batchSize) {
      const batch = accountsToUpdate.slice(i, i + batchSize);
      const ids = batch.map(account => account.id);
      
      console.log(`Updating batch ${Math.floor(i/batchSize) + 1} of ${Math.ceil(accountsToUpdate.length/batchSize)}`);
      
      const { error: updateError } = await supabase
        .from('gl_accounts')
        .update({ tenant_id: '00000000-0000-0000-0000-000000000001' })
        .in('id', ids);
        
      if (updateError) {
        console.log('Error updating batch:', updateError.message);
      } else {
        console.log(`✅ Updated batch ${Math.floor(i/batchSize) + 1}`);
      }
      
      // Add a small delay to prevent overwhelming the database
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Verify the update
    console.log('\n3. Verifying update...');
    const { data: verifyAccounts, error: verifyError } = await supabase
      .from('gl_accounts')
      .select('tenant_id');
      
    if (verifyError) {
      console.log('Error verifying update:', verifyError.message);
    } else {
      // Group by tenant_id manually
      const tenantMap = {};
      verifyAccounts.forEach(account => {
        const id = account.tenant_id || 'null';
        tenantMap[id] = (tenantMap[id] || 0) + 1;
      });
      console.log('Updated tenant distribution:', tenantMap);
    }
    
    // Check if organizations table exists
    console.log('\n4. Checking organizations table...');
    const { data: orgData, error: orgError } = await supabase
      .from('organizations')
      .select('id, name')
      .limit(1);
      
    if (orgError) {
      console.log('Organizations table may not exist:', orgError.message);
      console.log('You may need to create it manually in Supabase SQL editor');
    } else {
      console.log('Organizations table exists:', orgData);
    }
    
    console.log('\n✅ Fix completed! Please restart your application.');
    
  } catch (error) {
    console.error('Unexpected error:', error);
  }
}

runFix();