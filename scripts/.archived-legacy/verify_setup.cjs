const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: require('node:path').join(__dirname, '.env') });

// ⚠️ SECURITY: Load Supabase configuration from environment variables
// Never hardcode API keys in source code!
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ ERROR: Missing Supabase configuration!');
  console.error('Please set SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env file');
  console.error('See .env.example for reference');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function verifySetup() {
  console.log('🔍 Verifying Wardah ERP Database Setup...\n');
  
  try {
    // Check if organizations table exists
    console.log('1. Checking organizations table...');
    const { data: orgs, error: orgError } = await supabase
      .from('organizations')
      .select('id, name')
      .limit(1);
    
    if (orgError) {
      console.log('❌ Organizations table error:', orgError.message);
      return;
    }
    
    console.log('✅ Organizations table exists');
    if (orgs.length > 0) {
      console.log('🏢 Sample organization found:', orgs[0].name);
    } else {
      console.log('⚠️ No organizations found');
    }
    
    // Check if gl_accounts table exists
    console.log('\n2. Checking gl_accounts table...');
    const { data: accounts, error: accountsError } = await supabase
      .from('gl_accounts')
      .select('id, code, name')
      .limit(1);
    
    if (accountsError) {
      console.log('❌ GL accounts table error:', accountsError.message);
      return;
    }
    
    console.log('✅ GL accounts table exists');
    if (accounts.length > 0) {
      console.log('💰 Sample account found:', accounts[0].code, '-', accounts[0].name);
    } else {
      console.log('⚠️ No accounts found');
    }
    
    // Check if user_organizations table exists
    console.log('\n3. Checking user_organizations table...');
    const { data: userOrgs, error: userOrgError } = await supabase
      .from('user_organizations')
      .select('id, user_id, org_id')
      .limit(1);
    
    if (userOrgError) {
      console.log('❌ User organizations table error:', userOrgError.message);
      return;
    }
    
    console.log('✅ User organizations table exists');
    if (userOrgs.length > 0) {
      console.log('👥 Sample user-organization association found');
    } else {
      console.log('⚠️ No user-organization associations found');
    }
    
    // Count total accounts
    console.log('\n4. Counting total accounts...');
    const { count, error: countError } = await supabase
      .from('gl_accounts')
      .select('*', { count: 'exact', head: true });
    
    if (countError) {
      console.log('❌ Count error:', countError.message);
    } else {
      console.log(`📊 Total accounts in database: ${count}`);
    }
    
    console.log('\n✅ Database verification completed!');
    
  } catch (error) {
    console.error('❌ Verification failed:', error.message);
  }
}

verifySetup();