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

async function checkTableStructure() {
  console.log('Checking labor_entries table structure...');
  
  try {
    // Try to get column information using a direct query
    const { data, error } = await supabase.rpc('execute_sql', {
      sql: `
        SELECT 
          column_name,
          data_type,
          is_nullable,
          column_default
        FROM information_schema.columns 
        WHERE table_name = 'labor_entries'
        ORDER BY ordinal_position;
      `
    });
    
    if (error) {
      console.log('Error getting column information:', error.message);
      // Try alternative approach
      await checkTableStructureAlternative();
    } else {
      console.log('Column information for labor_entries table:');
      console.log(data);
      
      // Check if mo_id column exists
      const moIdColumn = data.find(col => col.column_name === 'mo_id');
      if (moIdColumn) {
        console.log('✓ mo_id column exists');
      } else {
        console.log('✗ mo_id column is missing');
      }
    }
  } catch (err) {
    console.log('Error:', err.message);
    await checkTableStructureAlternative();
  }
}

async function checkTableStructureAlternative() {
  console.log('Using alternative method to check table structure...');
  
  // Try to describe the table structure by selecting specific columns
  try {
    // First, try to select all columns to see what's available
    const { data: allData, error: allError } = await supabase
      .from('labor_entries')
      .select('*')
      .limit(1);
    
    if (allError) {
      console.log('Error getting sample data:', allError.message);
      
      // Try selecting common columns one by one
      const commonColumns = ['id', 'created_at', 'updated_at', 'mo_id', 'work_center_id', 'hours_worked', 'hourly_rate', 'total_cost'];
      
      for (const column of commonColumns) {
        try {
          const { data, error } = await supabase
            .from('labor_entries')
            .select(column)
            .limit(1);
          
          if (error) {
            console.log(`✗ Column ${column} does not exist or is not accessible`);
          } else {
            console.log(`✓ Column ${column} exists`);
          }
        } catch (err) {
          console.log(`✗ Error checking column ${column}:`, err.message);
        }
      }
    } else {
      console.log('Successfully retrieved sample data from labor_entries table.');
      if (allData && allData.length > 0) {
        const keys = Object.keys(allData[0]);
        console.log('Available columns:', keys);
        
        // Check if mo_id column exists
        if (keys.includes('mo_id')) {
          console.log('✓ mo_id column exists');
        } else {
          console.log('✗ mo_id column is missing');
        }
      } else {
        console.log('No data found in labor_entries table');
      }
    }
  } catch (err) {
    console.log('Error in alternative method:', err.message);
  }
  
  // Check manufacturing_orders table for reference
  console.log('\nChecking manufacturing_orders table structure...');
  
  try {
    const { data: moSample, error: moError } = await supabase
      .from('manufacturing_orders')
      .select('*')
      .limit(1);
    
    if (moError) {
      console.log('Error accessing manufacturing_orders table:', moError.message);
    } else {
      console.log('Successfully accessed manufacturing_orders table.');
      if (moSample && moSample.length > 0) {
        const moKeys = Object.keys(moSample[0]);
        console.log('MO table columns:', moKeys);
      }
    }
  } catch (err) {
    console.log('Error checking manufacturing_orders table:', err.message);
  }
}

// Run the diagnostic
checkTableStructure().catch(console.error);