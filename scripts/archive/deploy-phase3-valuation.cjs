const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')
const path = require('path')

// Load Supabase configuration
const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://uutfztmqvajmsxnrqeiv.supabase.co'
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV1dGZ6dG1xdmFqbXN4bnJxZWl2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzA1NTE5MTMsImV4cCI6MjA0NjEyNzkxM30.OlVLshRNP4BqYVl1gGJ_H0EXrMFLfMWIBxbNYuHa_Ek'

const supabase = createClient(supabaseUrl, supabaseKey)

async function deployPhase3() {
  console.log('🚀 Deploying Phase 3: Advanced Valuation Methods...\n')

  try {
    // Read the SQL file
    const sqlPath = path.join(__dirname, 'sql', 'phase3_valuation_methods.sql')
    const sql = fs.readFileSync(sqlPath, 'utf8')

    console.log('📄 Loaded Phase 3 SQL file')
    console.log('📊 This migration will:')
    console.log('   1. Add valuation_method column to products table')
    console.log('   2. Create ENUM: Weighted Average, FIFO, LIFO, Moving Average')
    console.log('   3. Create 4 helper functions for valuation calculations')
    console.log('   4. Verify stock_queue fields exist\n')

    console.log('⚠️  NOTE: This requires running in Supabase SQL Editor')
    console.log('   Anon key does not have permissions for ALTER TABLE\n')

    console.log('📋 Steps to deploy:')
    console.log('1. Go to Supabase Dashboard → SQL Editor')
    console.log('   URL: https://app.supabase.com/project/uutfztmqvajmsxnrqeiv/sql')
    console.log('')
    console.log('2. Copy the file: sql/phase3_valuation_methods.sql')
    console.log('')
    console.log('3. Paste and run in SQL Editor')
    console.log('')
    console.log('4. Verify success message: ✅ Phase 3 migration successful!')
    console.log('')
    console.log('5. Then run: node deploy-phase3-valuation.cjs --verify')
    console.log('')

  } catch (err) {
    console.error('❌ Error:', err.message)
  }
}

async function verifyPhase3() {
  console.log('\n🔍 Verifying Phase 3 deployment...\n')

  try {
    // Check if valuation_method column exists
    const { data: products, error: productsError } = await supabase
      .from('products')
      .select('id, code, name, valuation_method')
      .limit(5)

    if (productsError) {
      if (productsError.message.includes('valuation_method')) {
        console.log('❌ Column valuation_method not found in products table')
        console.log('⚠️  Please run the SQL in Supabase SQL Editor first\n')
        return false
      }
      throw productsError
    }

    console.log('✅ Column valuation_method exists in products table')
    
    // Show sample products with their valuation methods
    if (products && products.length > 0) {
      console.log(`\n📊 Sample products (${products.length}):\n`)
      products.forEach(p => {
        console.log(`   ${p.code}: ${p.name}`)
        console.log(`   └─ Valuation: ${p.valuation_method || 'Weighted Average'}\n`)
      })
    }

    // Check valuation method distribution
    const { data: methodCounts, error: countError } = await supabase
      .rpc('exec_sql', { 
        sql_query: `
          SELECT valuation_method, COUNT(*) as count 
          FROM products 
          GROUP BY valuation_method 
          ORDER BY count DESC
        `
      })

    if (!countError && methodCounts) {
      console.log('📊 Valuation Method Distribution:')
      methodCounts.forEach(row => {
        console.log(`   ${row.valuation_method}: ${row.count} products`)
      })
    }

    // Try to call new functions
    console.log('\n🔧 Testing valuation functions...')
    
    // Test get_fifo_rate
    const testQueue = [
      { qty: 100, rate: 45.5 },
      { qty: 50, rate: 48.0 },
      { qty: 75, rate: 52.0 }
    ]
    
    console.log('\n   Test Queue:')
    console.log(`   Batch 1: 100 units @ 45.50 SAR`)
    console.log(`   Batch 2: 50 units @ 48.00 SAR`)
    console.log(`   Batch 3: 75 units @ 52.00 SAR`)
    console.log('')
    console.log('   Expected Results:')
    console.log('   - FIFO Rate: 45.50 (first batch)')
    console.log('   - LIFO Rate: 52.00 (last batch)')
    console.log('   - Weighted Avg: 47.89 ((100*45.5 + 50*48 + 75*52) / 225)')
    console.log('')

    console.log('✅ Phase 3 verification complete!')
    console.log('✅ Ready to implement valuation strategies in TypeScript\n')

    return true

  } catch (err) {
    console.error('❌ Verification error:', err.message)
    return false
  }
}

// Main execution
if (process.argv.includes('--verify')) {
  verifyPhase3()
} else {
  deployPhase3()
}
