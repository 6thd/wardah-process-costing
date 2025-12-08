const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

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

async function verifyAccounts() {
  console.log('🔍 Verifying Chart of Accounts...\n');
  
  try {
    // Count total accounts
    console.log('1. Counting total accounts...');
    const { count, error: countError } = await supabase
      .from('gl_accounts')
      .select('*', { count: 'exact', head: true });
    
    if (countError) {
      console.log('❌ Count error:', countError.message);
      if (countError.message.includes('stack depth limit exceeded')) {
        console.log('\n⚠️  This is the stack depth limit issue we need to fix in Supabase settings');
      }
      return;
    }
    
    console.log(`📊 Total accounts in database: ${count}`);
    
    // Show first 10 accounts
    console.log('\n2. Showing first 10 accounts...');
    const { data: accounts, error: accountsError } = await supabase
      .from('gl_accounts')
      .select('code, name, category')
      .order('code')
      .limit(10);
    
    if (accountsError) {
      console.log('❌ Accounts query error:', accountsError.message);
      return;
    }
    
    console.log('📋 First 10 accounts:');
    accounts.forEach((account, index) => {
      console.log(`  ${index + 1}. ${account.code} - ${account.name} (${account.category})`);
    });
    
    if (count > 10) {
      console.log(`  ... and ${count - 10} more accounts`);
    }
    
    console.log('\n✅ Verification completed!');
    
  } catch (error) {
    console.error('❌ Verification failed:', error.message);
  }
}

verifyAccounts();