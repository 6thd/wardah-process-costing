import { createClient } from '@supabase/supabase-js';

// Configuration from your config.json
const supabaseUrl = 'https://rytzljjlthouptdqeuxh.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ5dHpsampsdGhvdXB0ZHFldXhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc4Mzc1NTYsImV4cCI6MjA3MzQxMzU1Nn0.5VAgxgoiWIkA05WYVnTDJ0wUOTkWxAo0a0VY6-J7DoY';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function diagnoseDatabase() {
  console.log('🔍 Diagnosing database structure...\n');

  try {
    // Check if users table exists by querying it
    console.log('1. Checking if users table exists...');
    const { data: usersData, error: usersError } = await supabase
      .from('users')
      .select('count')
      .limit(1);

    if (usersError) {
      console.log('❌ Users table error:', usersError.message);
    } else {
      console.log('✅ Users table exists and is accessible');
    }

    // Check if gl_accounts table exists
    console.log('\n2. Checking if gl_accounts table exists...');
    const { data: glData, error: glError } = await supabase
      .from('gl_accounts')
      .select('count')
      .limit(1);

    if (glError) {
      console.log('❌ gl_accounts table error:', glError.message);
    } else {
      console.log('✅ gl_accounts table exists and is accessible');
    }

    // Check auth.users table
    console.log('\n3. Checking auth.users table...');
    const { data: authData, error: authError } = await supabase
      .from('auth.users')
      .select('id, email')
      .limit(5);

    if (authError) {
      console.log('❌ auth.users table error:', authError.message);
    } else {
      console.log('✅ auth.users table accessible');
      console.log('Sample users:', authData);
    }

    // Check gl_accounts data
    console.log('\n4. Checking gl_accounts data...');
    const { data: accountsData, error: accountsError } = await supabase
      .from('gl_accounts')
      .select('id, code, name, tenant_id')
      .limit(5);

    if (accountsError) {
      console.log('❌ gl_accounts data error:', accountsError.message);
    } else {
      console.log('✅ gl_accounts data accessible');
      console.log('Sample accounts:', accountsData);
    }

    // Check tenant_id distribution
    console.log('\n5. Checking tenant_id distribution...');
    const { data: tenantData, error: tenantError } = await supabase
      .from('gl_accounts')
      .select('tenant_id, count(*)')
      .group('tenant_id');

    if (tenantError) {
      console.log('❌ Tenant distribution error:', tenantError.message);
    } else {
      console.log('✅ Tenant distribution data:');
      console.log(tenantData);
    }

  } catch (error) {
    console.error('Unexpected error during diagnosis:', error);
  }
}

diagnoseDatabase();