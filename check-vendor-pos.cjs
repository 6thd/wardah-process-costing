const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = 'https://uutfztmqvajmsxnrqeiv.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV1dGZ6dG1xdmFqbXN4bnJxZWl2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NzA5OTM4MCwiZXhwIjoyMDcyNjc1MzgwfQ.le_6nb8rO8_WvBqP_BXycSP79MURAaNVSkHAkxZ-0gM'

const supabase = createClient(supabaseUrl, supabaseKey)

async function checkPurchaseOrders() {
  console.log('🔍 Checking purchase orders and vendors...\n')

  try {
    // 1. Check vendors
    console.log('1️⃣ Vendors:')
    const { data: vendors, error: vendorsError } = await supabase
      .from('vendors')
      .select('id, code, name')
      .order('code')

    if (vendorsError) throw vendorsError

    vendors.forEach(v => {
      console.log(`   ${v.code} - ${v.name} (ID: ${v.id.substring(0, 8)}...)`)
    })

    // 2. Check purchase orders
    console.log('\n2️⃣ Purchase Orders:')
    const { data: pos, error: posError } = await supabase
      .from('purchase_orders')
      .select('order_number, vendor_id, status, total_amount, vendor:vendors(code, name)')
      .order('order_number')

    if (posError) throw posError

    if (pos.length === 0) {
      console.log('   ⚠️ No purchase orders found!')
    } else {
      pos.forEach(po => {
        console.log(`   ${po.order_number} - Status: ${po.status}`)
        console.log(`      Vendor ID: ${po.vendor_id ? po.vendor_id.substring(0, 8) + '...' : 'NULL'}`)
        console.log(`      Vendor: ${po.vendor?.name || 'NOT FOUND'}`)
        console.log(`      Total: ${po.total_amount} SAR`)
      })
    }

    // 3. Check for specific vendor
    if (vendors.length > 0) {
      const testVendor = vendors[0]
      console.log(`\n3️⃣ POs for vendor "${testVendor.name}" (${testVendor.code}):`)
      
      const { data: vendorPOs, error: vpError } = await supabase
        .from('purchase_orders')
        .select('order_number, status, total_amount')
        .eq('vendor_id', testVendor.id)

      if (vpError) throw vpError

      if (vendorPOs.length === 0) {
        console.log('   ⚠️ No POs found for this vendor')
      } else {
        vendorPOs.forEach(po => {
          console.log(`   ✅ ${po.order_number} - ${po.status} - ${po.total_amount} SAR`)
        })
      }
    }

  } catch (error) {
    console.error('❌ Error:', error.message)
  }
}

checkPurchaseOrders()
