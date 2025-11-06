const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')

const supabaseUrl = 'https://uutfztmqvajmsxnrqeiv.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV1dGZ6dG1xdmFqbXN4bnJxZWl2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NzA5OTM4MCwiZXhwIjoyMDcyNjc1MzgwfQ.le_6nb8rO8_WvBqP_BXycSP79MURAaNVSkHAkxZ-0gM'

const supabase = createClient(supabaseUrl, supabaseKey)

async function runSQL() {
  console.log('🔧 Creating supplier invoices tables...\n')

  try {
    const sql = fs.readFileSync('create_supplier_invoices_tables.sql', 'utf8')
    
    // Execute using Supabase SQL editor endpoint
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`
      },
      body: JSON.stringify({ sql_string: sql })
    })

    if (!response.ok) {
      console.log('⚠️ RPC not available, using manual execution...')
      
      // Check if tables exist
      const { data: tables, error: tablesError } = await supabase
        .from('supplier_invoices')
        .select('id')
        .limit(1)

      if (tablesError) {
        console.log('❌ Tables do not exist yet')
        console.log('📝 Please run this SQL manually in Supabase SQL Editor:')
        console.log('\n' + sql + '\n')
      } else {
        console.log('✅ supplier_invoices table already exists')
      }

      // Check supplier_invoice_lines
      const { data: lines, error: linesError } = await supabase
        .from('supplier_invoice_lines')
        .select('id')
        .limit(1)

      if (linesError) {
        console.log('❌ supplier_invoice_lines table does not exist yet')
      } else {
        console.log('✅ supplier_invoice_lines table already exists')
      }

    } else {
      console.log('✅ SQL executed successfully!')
    }

    // Verify tables
    console.log('\n🔍 Verifying tables...')
    const { data: invoices, error: invError } = await supabase
      .from('supplier_invoices')
      .select('*')
      .limit(0)

    if (invError) {
      console.log('❌ supplier_invoices:', invError.message)
    } else {
      console.log('✅ supplier_invoices table ready')
    }

    const { data: lines, error: linesError } = await supabase
      .from('supplier_invoice_lines')
      .select('*')
      .limit(0)

    if (linesError) {
      console.log('❌ supplier_invoice_lines:', linesError.message)
    } else {
      console.log('✅ supplier_invoice_lines table ready')
    }

  } catch (error) {
    console.error('❌ Error:', error.message)
  }
}

runSQL()
