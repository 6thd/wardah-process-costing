import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '.env') });

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