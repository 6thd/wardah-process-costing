const { createClient } = require('@supabase/supabase-js');

// Use your Supabase project URL and API key
const supabaseUrl = 'https://rytzljjlthouptdqeuxh.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ5dHpsampsdGhvdXB0ZHFldXhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc4Mzc1NTYsImV4cCI6MjA3MzQxMzU1Nn0.5VAgxgoiWIkA05WYVnTDJ0wUOTkWxAo0a0VY6-J7DoY';

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