const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = 'https://uutfztmqvajmsxnrqeiv.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV1dGZ6dG1xdmFqbXN4bnJxZWl2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NzA5OTM4MCwiZXhwIjoyMDcyNjc1MzgwfQ.le_6nb8rO8_WvBqP_BXycSP79MURAaNVSkHAkxZ-0gM'

const supabase = createClient(supabaseUrl, supabaseKey)

async function checkV002() {
  console.log('🔍 Checking V002 vendor...\n')

  try {
    // Find V002 vendor
    const { data: vendor, error: vendorError } = await supabase
      .from('vendors')
      .select('*')
      .eq('code', 'V002')
      .single()

    if (vendorError) throw vendorError

    console.log('✅ Vendor V002:')
    console.log('   ID:', vendor.id)
    console.log('   Code:', vendor.code)
    console.log('   Name:', vendor.name)

    // Get POs for this vendor
    console.log('\n📦 Purchase Orders for V002:')
    const { data: pos, error: posError } = await supabase
      .from('purchase_orders')
      .select('order_number, status, total_amount, order_date')
      .eq('vendor_id', vendor.id)
      .order('order_date', { ascending: false })

    if (posError) throw posError

    if (pos.length === 0) {
      console.log('   ❌ No purchase orders found!')
    } else {
      console.log(`   Found ${pos.length} purchase orders:`)
      pos.forEach((po, i) => {
        console.log(`   ${i+1}. ${po.order_number}`)
        console.log(`      Status: ${po.status}`)
        console.log(`      Total: ${po.total_amount} SAR`)
        console.log(`      Date: ${po.order_date}`)
      })
    }

  } catch (error) {
    console.error('❌ Error:', error.message)
  }
}

checkV002()
