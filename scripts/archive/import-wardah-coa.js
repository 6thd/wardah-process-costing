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

async function importWardahCOA() {
  try {
    console.log('🔄 Starting Wardah Enhanced COA import...');
    
    const accounts = [];
    
    // Read CSV file
    await new Promise((resolve, reject) => {
      fs.createReadStream('wardah_erp_handover/wardah_enhanced_coa.csv')
        .pipe(csv())
        .on('data', (row) => {
          // Process each row with proper data types
          const account = {
            org_id: ORG_ID,
            code: row.code,
            name: row.name,
            category: row.category,
            subtype: row.subtype || null,
            parent_code: row.parent_code || null,
            normal_balance: row.normal_balance,
            allow_posting: row.allow_posting === 'TRUE' || row.allow_posting === 'true',
            is_active: row.is_active === 'TRUE' || row.is_active === 'true',
            currency: row.currency || 'SAR',
            notes: row.notes || null
          };
          accounts.push(account);
        })
        .on('end', resolve)
        .on('error', reject);
    });
    
    console.log(`📊 Found ${accounts.length} accounts to import`);
    
    // Import accounts in batches to avoid issues
    const batchSize = 10;
    let successCount = 0;
    let errorCount = 0;
    
    for (let i = 0; i < accounts.length; i += batchSize) {
      const batch = accounts.slice(i, i + batchSize);
      
      try {
        const { error } = await supabase
          .from('gl_accounts')
          .insert(batch);
        
        if (error) {
          console.error(`❌ Error importing batch ${Math.floor(i/batchSize) + 1}:`, error);
          errorCount += batch.length;
        } else {
          successCount += batch.length;
          console.log(`✅ Imported batch ${Math.floor(i/batchSize) + 1}: ${batch.length} accounts`);
        }
        
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 200));
        
      } catch (err) {
        console.error(`❌ Exception importing batch ${Math.floor(i/batchSize) + 1}:`, err);
        errorCount += batch.length;
      }
    }
    
    console.log('\n📊 Import Summary:');
    console.log(`   ✅ Successfully imported: ${successCount} accounts`);
    console.log(`   ❌ Failed to import: ${errorCount} accounts`);
    console.log(`   📈 Total processed: ${accounts.length} accounts`);
    
    if (errorCount === 0) {
      console.log('\n🎉 All Wardah COA accounts imported successfully!');
      console.log('🔄 Please refresh the Chart of Accounts page to see the results.');
    } else {
      console.log('\n⚠️ Some accounts failed to import. Check the errors above.');
    }
    
  } catch (error) {
    console.error('💥 Import failed:', error);
    process.exit(1);
  }
}

// Run the import
importWardahCOA();
