const { createClient } = require('@supabase/supabase-js');

// Use your Supabase project URL and API key
const supabaseUrl = 'https://rytzljjlthouptdqeuxh.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ5dHpsampsdGhvdXB0ZHFldXhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc4Mzc1NTYsImV4cCI6MjA3MzQxMzU1Nn0.5VAgxgoiWIkA05WYVnTDJ0wUOTkWxAo0a0VY6-J7DoY';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkDatabaseSimple() {
  console.log('🔍 Simple database connectivity check...\n');
  
  try {
    // Try to get session to check auth
    console.log('1. Checking authentication...');
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
    
    // Try a simple database query with very limited data
    console.log('\n2. Testing database query...');
    const { data: tables, error: tableError } = await supabase
      .from('gl_accounts')
      .select('id')
      .limit(1);
    
    if (tableError) {
      console.log('❌ Database query error:', tableError.message);
      if (tableError.message.includes('stack depth limit exceeded')) {
        console.log('\n⚠️  The stack depth limit issue is still present.');
        console.log('   This could be because:');
        console.log('   1. The max_stack_depth parameter has not been increased yet');
        console.log('   2. The database has not been restarted after the change');
        console.log('   3. The restart is still in progress (can take a few minutes)');
        console.log('   4. The change was not saved properly');
        
        console.log('\n📋 To fix this issue:');
        console.log('   1. Go to your Supabase dashboard at https://rytzljjlthouptdqeuxh.supabase.co');
        console.log('   2. Navigate to Settings > Database');
        console.log('   3. Find "max_stack_depth" in the configuration parameters');
        console.log('   4. Increase it from 2048kB to 4096kB (or higher if needed)');
        console.log('   5. Click "Save" and then "Restart" the database');
        console.log('   6. Wait for the restart to complete (usually 2-5 minutes)');
        console.log('   7. Try again after the restart is complete');
      }
      return;
    }
    
    console.log('✅ Database query successful');
    console.log(`   Found ${tables.length} test record(s)`);
    
    // Try to count records
    console.log('\n3. Counting records...');
    const { count, error: countError } = await supabase
      .from('gl_accounts')
      .select('*', { count: 'exact', head: true });
    
    if (countError) {
      console.log('❌ Count error:', countError.message);
      return;
    }
    
    console.log(`✅ Total records in gl_accounts: ${count}`);
    
    console.log('\n✅ Database connectivity check completed successfully!');
    
  } catch (error) {
    console.error('❌ Database connectivity check failed:', error.message);
  }
}

checkDatabaseSimple();