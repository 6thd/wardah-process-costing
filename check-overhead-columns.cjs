const { createClient } = require('@supabase/supabase-js');

// Supabase configuration from config.json
const SUPABASE_URL = 'https://rytzljjlthouptdqeuxh.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ5dHpsampsdGhvdXB0ZHFldXhoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NzgzNzU1NiwiZXhwIjoyMDczNDEzNTU2fQ.jcHrsuij3JafysuxrSO-J6q-7llnj-wDocUVjCjRXao';

// Create Supabase client with service role key for full access
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function checkColumns() {
  console.log('Checking specific columns in overhead_allocations table...');
  
  // List of columns we want to check
  const columnsToCheck = [
    'id',
    'created_at',
    'updated_at',
    'mo_id',
    'manufacturing_order_id',
    'work_center_id',
    'overhead_rate_id',
    'allocated_hours',
    'allocated_amount',
    'date'
  ];
  
  console.log('Checking if columns exist in overhead_allocations table:');
  
  for (const column of columnsToCheck) {
    try {
      // Try to select this specific column
      const { data, error } = await supabase
        .from('overhead_allocations')
        .select(column)
        .limit(1);
      
      if (error) {
        console.log(`✗ Column "${column}" - Error: ${error.message}`);
      } else {
        console.log(`✓ Column "${column}" - Exists and accessible`);
      }
    } catch (err) {
      console.log(`✗ Column "${column}" - Exception: ${err.message}`);
    }
  }
}

// Run the column check
checkColumns().catch(console.error);