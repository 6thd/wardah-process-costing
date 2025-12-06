
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const supabaseUrl = 'https://rytzljjlthouptdqeuxh.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ5dHpsampsdGhvdXB0ZHFldXhoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NzgzNzU1NiwiZXhwIjoyMDczNDEzNTU2fQ.jcHrsuij3JafysuxrSO-J6q-7llnj-wDocUVjCjRXao';

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
