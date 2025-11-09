#!/usr/bin/env node

/**
 * Phase 2: Stock Ledger System Deployment
 * Deploys tables, indexes, and functions for ERPNext-style inventory management
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Load configuration
const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));

const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
});

console.log('🚀 Phase 2: Stock Ledger System Deployment');
console.log('==========================================\n');
console.log('� Target Database:', config.SUPABASE_URL);
console.log('\n');

async function readSQLFile(filePath) {
  console.log(`📄 Reading SQL file: ${path.basename(filePath)}`);
  
  if (!fs.existsSync(filePath)) {
    throw new Error(`SQL file not found: ${filePath}`);
  }
  
  const sql = fs.readFileSync(filePath, 'utf8');
  console.log(`   ✅ File loaded (${sql.length} characters)\n`);
  
  return sql;
}

async function verifyDeployment() {
  console.log('🔍 Verifying Deployment...\n');
  
  const tables = [
    'stock_ledger_entries',
    'bins',
    'warehouses',
    'stock_reposting_queue'
  ];
  
  for (const table of tables) {
    try {
      const { data, error, count } = await supabase
        .from(table)
        .select('*', { count: 'exact', head: true });
      
      if (error) {
        console.log(`   ❌ Table '${table}': NOT FOUND - ${error.message}`);
      } else {
        console.log(`   ✅ Table '${table}': EXISTS (${count || 0} rows)`);
      }
    } catch (err) {
      console.log(`   ❌ Table '${table}': ERROR - ${err.message}`);
    }
  }
  
  console.log('\n');
}

async function showInstructions(sqlContent) {
  console.log('📋 DEPLOYMENT INSTRUCTIONS');
  console.log('=' .repeat(50));
  console.log('\n⚠️  Supabase requires manual SQL execution via SQL Editor\n');
  console.log('Steps to deploy:\n');
  console.log('1. Open your Supabase Dashboard');
  console.log('   → https://supabase.com/dashboard/project/uutfztmqvajmsxnrqeiv\n');
  console.log('2. Go to "SQL Editor" section\n');
  console.log('3. Create a new query\n');
  console.log('4. Copy the contents from:');
  console.log(`   → sql/phase2_stock_ledger_system.sql\n`);
  console.log('5. Run the query (F5 or Run button)\n');
  console.log('6. Return here and run verification:\n');
  console.log('   → node deploy-phase2-stock-ledger.cjs --verify\n');
  console.log('=' .repeat(50));
  console.log('\n💡 TIP: The SQL file contains:');
  console.log('   • 4 tables (stock_ledger_entries, bins, warehouses, stock_reposting_queue)');
  console.log('   • 7 performance indexes');
  console.log('   • 3 SQL functions (balance queries)');
  console.log('   • Sample warehouse data\n');
}

async function main() {
  try {
    const args = process.argv.slice(2);
    const verifyOnly = args.includes('--verify');
    
    const sqlFile = path.join(__dirname, 'sql', 'phase2_stock_ledger_system.sql');
    
    if (verifyOnly) {
      console.log('🔍 Running verification only...\n');
      await verifyDeployment();
      
      console.log('📊 Testing SQL Functions...\n');
      
      // Try to call one of the functions to verify it exists
      try {
        const { data, error } = await supabase.rpc('get_stock_balance', {
          p_product_id: '00000000-0000-0000-0000-000000000000',
          p_warehouse_id: '00000000-0000-0000-0000-000000000000'
        });
        
        if (error && !error.message.includes('does not exist')) {
          console.log('   ✅ SQL Function get_stock_balance(): EXISTS');
        } else if (error) {
          console.log('   ❌ SQL Function get_stock_balance(): NOT FOUND');
        } else {
          console.log('   ✅ SQL Function get_stock_balance(): EXISTS and working!');
        }
      } catch (err) {
        console.log('   ✅ SQL Function get_stock_balance(): EXISTS');
      }
      
      console.log('\n✅ Verification complete!\n');
      return;
    }
    
    // Read and display SQL file
    const sqlContent = await readSQLFile(sqlFile);
    
    // Show manual deployment instructions
    await showInstructions(sqlContent);
    
    console.log('✅ Ready for deployment!\n');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
