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

async function simpleCheck() {
  console.log('🔍 Simple database check...\n');
  
  try {
    // Simple query to check if we can connect
    console.log('1. Checking database connection...');
    const { data, error } = await supabase
      .from('gl_accounts')
      .select('count')
      .limit(1);
    
    if (error) {
      console.log('❌ Connection error:', error.message);
      return;
    }
    
    console.log('✅ Database connection successful');
    
    // Check if table exists by trying to count
    console.log('\n2. Checking if gl_accounts table exists...');
    const { count, error: countError } = await supabase
      .from('gl_accounts')
      .select('*', { count: 'exact', head: true });
    
    if (countError) {
      console.log('❌ Table check error:', countError.message);
      return;
    }
    
    console.log(`✅ gl_accounts table exists with ${count} records`);
    
  } catch (error) {
    console.error('❌ Check failed:', error.message);
  }
}

simpleCheck();