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
  console.log('Checking specific columns in labor_entries table...');
  
  // List of columns we want to check
  const columnsToCheck = [
    'id',
    'created_at',
    'updated_at',
    'mo_id',
    'manufacturing_order_id',
    'work_center_id',
    'employee_id',
    'hours_worked',
    'hourly_rate',
    'total_cost',
    'date',
    'notes'
  ];
  
  console.log('Checking if columns exist in labor_entries table:');
  
  for (const column of columnsToCheck) {
    try {
      // Try to select this specific column
      const { data, error } = await supabase
        .from('labor_entries')
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
  
  console.log('\nChecking manufacturing_orders table for reference:');
  
  // Check manufacturing_orders table columns
  const moColumnsToCheck = [
    'id',
    'order_number',
    'product_id',
    'quantity',
    'status',
    'start_date',
    'end_date',
    'created_at',
    'updated_at'
  ];
  
  console.log('Checking if columns exist in manufacturing_orders table:');
  
  for (const column of moColumnsToCheck) {
    try {
      const { data, error } = await supabase
        .from('manufacturing_orders')
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