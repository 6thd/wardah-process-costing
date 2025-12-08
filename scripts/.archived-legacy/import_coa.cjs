
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const csv = require('csv-parser');
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

// ⚠️ SECURITY: Load Supabase configuration from environment variables
// Never hardcode API keys in source code!
// Note: This script uses SERVICE_KEY for admin operations
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ ERROR: Missing Supabase configuration!');
  console.error('Please set SUPABASE_URL and SUPABASE_SERVICE_KEY in your .env file');
  console.error('See .env.example for reference');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const results = [];

fs.createReadStream('wardah_erp_handover/wardah_enhanced_coa.csv')
  .pipe(csv({
    mapHeaders: ({ header, index }) => header.trim()
  }))
  .on('data', (data) => results.push(data))
  .on('end', async () => {
    const filteredResults = results.filter(row => row.code && row.code.trim() !== '');
    console.log(`Read ${results.length} rows, filtered down to ${filteredResults.length} rows with a code.`);

    const accounts = filteredResults.map(row => ({
      code: row.code,
      name: row.name,
      type: row.category, // Mapping category to type
      subtype: row.subtype,
      parent_code: row.parent_code || null,
      normal_balance: row.normal_balance,
      allow_posting: row.allow_posting.toLowerCase() === 'true',
      is_active: true,
      org_id: '00000000-0000-0000-0000-000000000001', // Default Org
      currency: 'IDR',
      notes: row.notes
    }));

    // Batch insert
    const batchSize = 100;
    for (let i = 0; i < accounts.length; i += batchSize) {
      const batch = accounts.slice(i, i + batchSize);
      const { error } = await supabase.from('gl_accounts').insert(batch);
      if (error) {
        console.error('Error importing accounts:', error);
        return;
      }
    }
    console.log(`✅ Successfully imported ${accounts.length} accounts.`);
    runNextScript();
  });

async function runNextScript() {
    // Delete existing mappings for the org
    const { error: deleteError } = await supabase
        .from('gl_mappings')
        .delete()
        .eq('org_id', '00000000-0000-0000-0000-000000000001');

    if (deleteError) {
        console.error('Error deleting old mappings:', deleteError);
        return;
    }
    console.log('✅ Successfully deleted old mappings.');

    // Now run the mappings import
    const mappingResults = [];
    fs.createReadStream('wardah_erp_handover/wardah_gl_mappings.csv')
      .pipe(csv({
        mapHeaders: ({ header, index }) => header.trim()
      }))
      .on('data', (data) => mappingResults.push(data))
      .on('end', async () => {
        const mappings = mappingResults.map(row => ({
            org_id: '00000000-0000-0000-0000-000000000001', // Default Org
            key_type: row.key_type,
            key_value: row.key_value,
            debit_account_code: row.debit_account,
            credit_account_code: row.credit_account,
            description: row.description,
            is_active: true
        }));

        const { error } = await supabase.from('gl_mappings').insert(mappings);
        if (error) {
            console.error('Error importing GL mappings:', error);
            return;
        }
        console.log(`✅ Successfully imported ${mappings.length} GL mappings.`);
      });
}
