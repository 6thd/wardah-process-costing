import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

// Supabase configuration
const supabaseUrl = 'https://rytzljjlthouptdqeuxh.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ5dHpsampsdGhvdXB0ZHFldXhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc4Mzc1NTYsImV4cCI6MjA3MzQxMzU1Nn0.5VAgxgoiWIkA05WYVnTDJ0wUOTkWxAo0a0VY6-J7DoY';

// Create Supabase client
const supabase = createClient(supabaseUrl, supabaseKey);

// Organization ID (using the default one from the setup)
const ORG_ID = '00000000-0000-0000-0000-000000000001';

// Function to import chart of accounts
async function importChartOfAccounts() {
  try {
    // Read the JSON data
    const coaDataPath = path.join(process.cwd(), 'sql', 'wardah_implementation', 'coa_data.json');
    const coaData = JSON.parse(fs.readFileSync(coaDataPath, 'utf8'));
    
    console.log(`Importing ${coaData.length} chart of accounts records...`);
    
    // Convert string boolean values to actual booleans
    const processedData = coaData.map(account => ({
      org_id: ORG_ID,
      code: account.code,
      name: account.name,
      category: account.category,
      subtype: account.subtype,
      parent_code: account.parent_code || null,
      normal_balance: account.normal_balance,
      allow_posting: account.allow_posting === 'True' || account.allow_posting === true,
      is_active: account.is_active === 'True' || account.is_active === true,
      currency: account.currency,
      notes: account.notes || null
    }));
    
    // Import data one record at a time to avoid stack depth issues
    let successCount = 0;
    for (let i = 0; i < processedData.length; i++) {
      const record = processedData[i];
      const { error } = await supabase
        .from('gl_accounts')
        .upsert(record, {
          onConflict: 'org_id,code'
        });
      
      if (error) {
        console.error(`Error importing record ${i + 1}:`, error);
        throw error;
      }
      
      successCount++;
      if ((i + 1) % 10 === 0) {
        console.log(`Imported ${i + 1} of ${processedData.length} records`);
      }
    }
    
    console.log('✅ Chart of Accounts imported successfully!');
    return successCount;
  } catch (error) {
    console.error('❌ Error importing Chart of Accounts:', error);
    throw error;
  }
}

// Function to import GL mappings
async function importGLMappings() {
  try {
    // Read the JSON data
    const mappingsDataPath = path.join(process.cwd(), 'sql', 'wardah_implementation', 'gl_mappings_data.json');
    const mappingsData = JSON.parse(fs.readFileSync(mappingsDataPath, 'utf8'));
    
    console.log(`Importing ${mappingsData.length} GL mappings records...`);
    
    // Process the data
    const processedData = mappingsData.map(mapping => ({
      org_id: ORG_ID,
      key_type: mapping.key_type,
      key_value: mapping.key_value,
      debit_account_code: mapping.debit_account,
      credit_account_code: mapping.credit_account,
      description: mapping.description || null,
      is_active: true
    }));
    
    // Import data one record at a time
    let successCount = 0;
    for (let i = 0; i < processedData.length; i++) {
      const record = processedData[i];
      const { error } = await supabase
        .from('gl_mappings')
        .upsert(record, {
          onConflict: 'org_id,key_type,key_value'
        });
      
      if (error) {
        console.error(`Error importing record ${i + 1}:`, error);
        throw error;
      }
      
      successCount++;
      if ((i + 1) % 10 === 0) {
        console.log(`Imported ${i + 1} of ${processedData.length} records`);
      }
    }
    
    console.log('✅ GL Mappings imported successfully!');
    return successCount;
  } catch (error) {
    console.error('❌ Error importing GL Mappings:', error);
    throw error;
  }
}

// Main function
async function main() {
  console.log('🔄 Starting data import to Supabase...');
  
  try {
    // Import Chart of Accounts
    const coaCount = await importChartOfAccounts();
    
    // Import GL Mappings
    const mappingsCount = await importGLMappings();
    
    console.log('✅ All data imported successfully!');
    console.log(`📊 Summary:`);
    console.log(`   - Chart of Accounts: ${coaCount} records`);
    console.log(`   - GL Mappings: ${mappingsCount} records`);
    
  } catch (error) {
    console.error('❌ Import failed:', error);
    process.exit(1);
  }
}

// Run the script
main();