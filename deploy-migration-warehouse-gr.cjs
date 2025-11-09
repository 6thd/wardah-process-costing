const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')
const path = require('path')

// Load Supabase configuration
const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://uutfztmqvajmsxnrqeiv.supabase.co'
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV1dGZ6dG1xdmFqbXN4bnJxZWl2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzA1NTE5MTMsImV4cCI6MjA0NjEyNzkxM30.OlVLshRNP4BqYVl1gGJ_H0EXrMFLfMWIBxbNYuHa_Ek'

const supabase = createClient(supabaseUrl, supabaseKey)

async function runMigration() {
  console.log('🚀 Starting migration: Add warehouse_id to goods_receipts...\n')

  try {
    // Read the SQL migration file
    const sqlPath = path.join(__dirname, 'sql', 'migration_add_warehouse_to_goods_receipts.sql')
    const sql = fs.readFileSync(sqlPath, 'utf8')

    console.log('📄 Loaded migration SQL file')
    console.log('📊 Executing SQL...\n')

    // Execute the SQL
    const { data, error } = await supabase.rpc('exec_sql', { sql_query: sql })

    if (error) {
      console.error('❌ Migration failed:', error)
      
      // Try alternative approach: use direct query
      console.log('\n⚠️  Trying direct SQL execution...\n')
      
      // Split SQL into individual statements
      const statements = sql
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0 && !s.startsWith('--') && !s.startsWith('/*'))

      for (const statement of statements) {
        if (statement.includes('ALTER TABLE') || statement.includes('CREATE INDEX') || statement.includes('COMMENT ON')) {
          console.log(`Executing: ${statement.substring(0, 60)}...`)
          
          // Note: Direct SQL execution requires service_role key or SQL editor
          console.log('⚠️  Please run this migration manually in Supabase SQL Editor')
        }
      }
      
      console.log('\n📋 Manual Steps:')
      console.log('1. Go to Supabase Dashboard → SQL Editor')
      console.log('2. Copy the contents of: sql/migration_add_warehouse_to_goods_receipts.sql')
      console.log('3. Paste and run in SQL Editor')
      console.log('4. Verify the migration succeeded\n')
      
      return
    }

    console.log('✅ Migration completed successfully!')
    console.log('✅ warehouse_id column added to goods_receipts table')

  } catch (err) {
    console.error('❌ Unexpected error:', err)
    console.log('\n📋 Please run the migration manually:')
    console.log('1. Go to Supabase Dashboard → SQL Editor')
    console.log('2. Copy the contents of: sql/migration_add_warehouse_to_goods_receipts.sql')
    console.log('3. Paste and run in SQL Editor\n')
  }
}

// Verification function
async function verifyMigration() {
  console.log('\n🔍 Verifying migration...\n')

  try {
    // Check if warehouse_id column exists
    const { data, error } = await supabase
      .from('goods_receipts')
      .select('id, gr_number, warehouse_id')
      .limit(1)

    if (error) {
      if (error.message.includes('warehouse_id')) {
        console.log('❌ Column warehouse_id not found')
        console.log('⚠️  Migration needs to be run\n')
        return false
      }
      console.error('Error checking column:', error)
      return false
    }

    console.log('✅ Column warehouse_id exists in goods_receipts table')
    
    // Check if warehouses exist
    const { data: warehouses, error: whError } = await supabase
      .from('warehouses')
      .select('code, name')

    if (whError) {
      console.error('⚠️  Warehouses table issue:', whError)
    } else {
      console.log(`✅ Found ${warehouses.length} warehouses:`)
      warehouses.forEach(wh => {
        console.log(`   - ${wh.code}: ${wh.name}`)
      })
    }

    console.log('\n✅ Migration verification successful!\n')
    return true

  } catch (err) {
    console.error('Error during verification:', err)
    return false
  }
}

// Main execution
if (process.argv.includes('--verify')) {
  verifyMigration()
} else {
  runMigration().then(() => {
    if (!process.argv.includes('--no-verify')) {
      setTimeout(() => verifyMigration(), 2000)
    }
  })
}
