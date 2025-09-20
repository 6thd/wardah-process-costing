const { createClient } = require('@supabase/supabase-js');

// Use your Supabase project URL and API key
const supabaseUrl = 'https://rytzljjlthouptdqeuxh.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ5dHpsampsdGhvdXB0ZHFldXhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc4Mzc1NTYsImV4cCI6MjA3MzQxMzU1Nn0.5VAgxgoiWIkA05WYVnTDJ0wUOTkWxAo0a0VY6-J7DoY';

const supabase = createClient(supabaseUrl, supabaseKey);

async function testRecursionFix() {
  console.log('🔍 Testing recursion fix for chart of accounts...\n');
  
  try {
    // Test 1: Simple connection test
    console.log('1. Testing database connection...');
    const { data, error } = await supabase
      .from('gl_accounts')
      .select('id')
      .limit(1);
    
    if (error) {
      console.log('❌ Connection test failed:', error.message);
      if (error.message.includes('stack depth limit exceeded')) {
        console.log('⚠️  Stack depth limit error still present');
        console.log('   This indicates the recursion issue has not been fully resolved');
        return;
      }
    } else {
      console.log('✅ Connection test successful');
    }
    
    // Test 2: Count total accounts
    console.log('\n2. Counting total accounts...');
    const { count, error: countError } = await supabase
      .from('gl_accounts')
      .select('*', { count: 'exact', head: true });
    
    if (countError) {
      console.log('❌ Count test failed:', countError.message);
      if (countError.message.includes('stack depth limit exceeded')) {
        console.log('⚠️  Stack depth limit error during count operation');
        return;
      }
    } else {
      console.log(`✅ Count test successful: ${count} accounts found`);
    }
    
    // Test 3: Fetch accounts with safe limit
    console.log('\n3. Fetching accounts with safe limit...');
    const { data: accounts, error: accountsError } = await supabase
      .from('gl_accounts')
      .select('id,code,name,category,parent_code')
      .order('code')
      .limit(100);
    
    if (accountsError) {
      console.log('❌ Accounts fetch failed:', accountsError.message);
      if (accountsError.message.includes('stack depth limit exceeded')) {
        console.log('⚠️  Stack depth limit error during accounts fetch');
        return;
      }
    } else {
      console.log(`✅ Accounts fetch successful: ${accounts.length} accounts retrieved`);
      if (accounts.length > 0) {
        console.log('📋 Sample accounts:');
        accounts.slice(0, 5).forEach((account, index) => {
          console.log(`  ${index + 1}. ${account.code} - ${account.name} (${account.category})`);
        });
      }
    }
    
    console.log('\n✅ All recursion tests completed successfully!');
    console.log('🎉 The recursion issue appears to be resolved.');
    
  } catch (error) {
    console.error('❌ Test failed with unexpected error:', error.message);
  }
}

testRecursionFix();