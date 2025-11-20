const { createClient } = require('@supabase/supabase-js');

// Use your Supabase project URL and API key
const supabaseUrl = 'https://rytzljjlthouptdqeuxh.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ5dHpsampsdGhvdXB0ZHFldXhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc4Mzc1NTYsImV4cCI6MjA3MzQxMzU1Nn0.5VAgxgoiWIkA05WYVnTDJ0wUOTkWxAo0a0VY6-J7DoY';

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