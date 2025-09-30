import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import csv from 'csv-parser';

// Supabase configuration
const supabaseUrl = 'https://rytzljjlthouptdqeuxh.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ5dHpsampsdGhvdXB0ZHFldXhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc4Mzc1NTYsImV4cCI6MjA3MzQxMzU1Nn0.5VAgxgoiWIkA05WYVnTDJ0wUOTkWxAo0a0VY6-J7DoY';

// Create Supabase client
const supabase = createClient(supabaseUrl, supabaseKey);

// Organization ID - استبدل هذا بـ org_id الصحيح لديك
const ORG_ID = '00000000-0000-0000-0000-000000000001';

async function importCSVAccounts() {
  try {
    console.log('🔄 Starting CSV import...');
    
    const accounts = [];
    
    // Read CSV file
    await new Promise((resolve, reject) => {
      fs.createReadStream('gl_accounts_update_20250916_094641.csv')
        .pipe(csv())
        .on('data', (row) => {
          // Process each row
          const account = {
            org_id: ORG_ID,
            code: row.code,
            name: row.name,
            category: row.category,
            subtype: row.subtype || null,
            parent_code: row.parent_code || null,
            normal_balance: row.category === 'ASSET' || row.category === 'EXPENSE' ? 'DEBIT' : 'CREDIT',
            allow_posting: true, // Default to true
            is_active: row.is_active === 'True' || row.is_active === 'true',
            currency: 'SAR', // Default currency
            notes: null
          };
          accounts.push(account);
        })
        .on('end', resolve)
        .on('error', reject);
    });
    
    console.log(`📊 Found ${accounts.length} accounts to import`);
    
    // Import accounts one by one to avoid issues
    let successCount = 0;
    let errorCount = 0;
    
    for (let i = 0; i < accounts.length; i++) {
      const account = accounts[i];
      
      try {
        const { error } = await supabase
          .from('gl_accounts')
          .insert(account);
        
        if (error) {
          console.error(`❌ Error importing account ${account.code}:`, error);
          errorCount++;
        } else {
          successCount++;
          console.log(`✅ Imported account ${account.code}: ${account.name}`);
        }
        
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (err) {
        console.error(`❌ Exception importing account ${account.code}:`, err);
        errorCount++;
      }
    }
    
    console.log('\n📊 Import Summary:');
    console.log(`   ✅ Successfully imported: ${successCount} accounts`);
    console.log(`   ❌ Failed to import: ${errorCount} accounts`);
    console.log(`   📈 Total processed: ${accounts.length} accounts`);
    
    if (errorCount === 0) {
      console.log('\n🎉 All accounts imported successfully!');
    } else {
      console.log('\n⚠️ Some accounts failed to import. Check the errors above.');
    }
    
  } catch (error) {
    console.error('💥 Import failed:', error);
    process.exit(1);
  }
}

// Run the import
importCSVAccounts();
