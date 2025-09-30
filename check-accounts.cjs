const { createClient } = require('@supabase/supabase-js');

// Get these from your Supabase project dashboard
const SUPABASE_URL = 'https://rytzljjlthouptdqeuxh.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ5dHpsampsdGhvdXB0ZHFldXhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc4Mzc1NTYsImV4cCI6MjA3MzQxMzU1Nn0.5VAgxgoiWIkA05WYVnTDJ0wUOTkWxAo0a0VY6-J7DoY';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function checkAccounts() {
  console.log('Testing basic database connectivity...');
  
  // Try a simple query on a table that should exist
  try {
    console.log('Testing with a simple table query...');
    const { data, error } = await supabase
      .from('organizations')
      .select('id')
      .limit(1);
    
    console.log('Organizations query result:', data);
    if (error) console.log('Organizations query error:', error);
  } catch (err) {
    console.log('Error in organizations query:', err.message);
  }
  
  // Try with a simple count
  try {
    console.log('Testing with a simple count query...');
    const { count, error } = await supabase
      .from('organizations')
      .select('*', { count: 'exact', head: true });
    
    console.log('Organizations count:', count);
    if (error) console.log('Count error:', error);
  } catch (err) {
    console.log('Error in count query:', err.message);
  }
}

checkAccounts().then(() => console.log('Done'));