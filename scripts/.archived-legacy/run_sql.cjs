
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

// ⚠️ SECURITY: Load Supabase configuration from environment variables
// Never hardcode API keys in source code!
// Note: This script uses SERVICE_KEY for admin operations
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ ERROR: Missing Supabase configuration!');
  console.error('Please set SUPABASE_URL and SUPABASE_SERVICE_KEY in your .env file');
  console.error('See .env.example for reference');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function runSql() {
  try {
    const sql = fs.readFileSync('check_gl_accounts_schema.sql', 'utf8');
    const { data, error } = await supabase.rpc('execute_sql', { sql });

    if (error) {
      console.error('Error executing SQL script:', error);
      return;
    }

    console.log('SQL script executed successfully');
    console.table(data);
  } catch (error) {
    console.error('An error occurred:', error);
  }
}

runSql();
