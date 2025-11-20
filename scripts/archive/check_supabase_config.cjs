const { createClient } = require('@supabase/supabase-js');

// Use your Supabase project URL and API key
const supabaseUrl = 'https://rytzljjlthouptdqeuxh.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ5dHpsampsdGhvdXB0ZHFldXhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc4Mzc1NTYsImV4cCI6MjA3MzQxMzU1Nn0.5VAgxgoiWIkA05WYVnTDJ0wUOTkWxAo0a0VY6-J7DoY';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkSupabaseConfig() {
  console.log('🔍 Checking Supabase configuration...\n');
  
  try {
    // Check if we can get the Supabase version
    console.log('1. Checking Supabase connection...');
    
    // Simple query to test connection
    const { data, error } = await supabase.rpc('version');
    
    if (error && !error.message.includes('function "version" does not exist')) {
      console.log('❌ Connection error:', error.message);
      return;
    }
    
    console.log('✅ Supabase connection successful');
    
    // Try to get session to check auth
    console.log('\n2. Checking authentication...');
    const { data: { session }, error: authError } = await supabase.auth.getSession();
    
    if (authError) {
      console.log('❌ Authentication error:', authError.message);
    } else {
      console.log('✅ Authentication check successful');
      if (session) {
        console.log('👤 User is authenticated');
      } else {
        console.log('🔒 No active session');
      }
    }
    
    // Try a simple database query
    console.log('\n3. Testing database query...');
    const { data: test, error: testError } = await supabase
      .from('gl_accounts')
      .select('id')
      .limit(1);
    
    if (testError) {
      console.log('❌ Database query error:', testError.message);
      if (testError.message.includes('stack depth limit exceeded')) {
        console.log('\n⚠️  The stack depth limit issue is still present.');
        console.log('   Please verify that you have:');
        console.log('   1. Increased max_stack_depth in Supabase settings');
        console.log('   2. Restarted the database after the change');
        console.log('   3. Waited for the restart to complete (this can take a few minutes)');
      }
    } else {
      console.log('✅ Database query successful');
      console.log(`   Found ${test.length} test record(s)`);
    }
    
    console.log('\n✅ Configuration check completed!');
    
  } catch (error) {
    console.error('❌ Configuration check failed:', error.message);
  }
}

checkSupabaseConfig();