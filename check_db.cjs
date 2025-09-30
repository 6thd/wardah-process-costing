const { createClient } = require('@supabase/supabase-js');

// Use your Supabase project URL and API key
const supabaseUrl = 'https://rytzljjlthouptdqeuxh.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ5dHpsampsdGhvdXB0ZHFldXhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc4Mzc1NTYsImV4cCI6MjA3MzQxMzU1Nn0.5VAgxgoiWIkA05WYVnTDJ0wUOTkWxAo0a0VY6-J7DoY';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkDatabase() {
  console.log('Checking database connection...');
  
  // Check if we can connect to the database
  try {
    // Try to get the current user (this will fail if not authenticated)
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError) {
      console.log('Auth error:', authError.message);
    } else {
      console.log('Current user:', user);
    }
    
    // Try to query the users table
    console.log('Querying users table...');
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('*')
      .limit(5);
    
    if (usersError) {
      console.log('Users table error:', usersError.message);
    } else {
      console.log('Users found:', users.length);
      console.log('First user:', users[0]);
    }
    
    // Try to query the gl_accounts table
    console.log('Querying gl_accounts table...');
    const { data: accounts, error: accountsError } = await supabase
      .from('gl_accounts')
      .select('*')
      .limit(5);
    
    if (accountsError) {
      console.log('GL accounts table error:', accountsError.message);
    } else {
      console.log('GL accounts found:', accounts.length);
      console.log('First account:', accounts[0]);
    }
    
    // Try to query the user_organizations table
    console.log('Querying user_organizations table...');
    const { data: userOrgs, error: userOrgsError } = await supabase
      .from('user_organizations')
      .select('*')
      .limit(5);
    
    if (userOrgsError) {
      console.log('User organizations table error:', userOrgsError.message);
    } else {
      console.log('User organizations found:', userOrgs.length);
      console.log('First user organization:', userOrgs[0]);
    }
    
  } catch (error) {
    console.error('Database check failed:', error);
  }
}

checkDatabase();