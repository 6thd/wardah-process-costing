const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = 'https://uutfztmqvajmsxnrqeiv.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV1dGZ6dG1xdmFqbXN4bnJxZWl2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NzA5OTM4MCwiZXhwIjoyMDcyNjc1MzgwfQ.le_6nb8rO8_WvBqP_BXycSP79MURAaNVSkHAkxZ-0gM'

const supabase = createClient(supabaseUrl, supabaseKey)

async function findAlgeriaVendor() {
  console.log('🔍 Searching for Algeria vendor...\n')

  try {
    // Search for vendors with "جزائر" in name
    const { data: vendors, error } = await supabase
      .from('vendors')
      .select('*')
      .ilike('name', '%جزائر%')

    if (error) throw error

    if (vendors.length === 0) {
      console.log('❌ No vendor found with "جزائر" in name')
      
      // Show all vendors
      console.log('\n📋 All vendors:')
      const { data: allVendors } = await supabase
        .from('vendors')
        .select('id, code, name')
        .order('code')

      allVendors.forEach(v => {
        console.log(`   ${v.code} - ${v.name}`)
        console.log(`      ID: ${v.id}`)
      })
    } else {
      console.log('✅ Found vendors with "جزائر":')
      vendors.forEach(v => {
        console.log(`   ${v.code} - ${v.name}`)
        console.log(`      ID: ${v.id}`)
      })

      // Check POs for each
      for (const vendor of vendors) {
        const { data: pos } = await supabase
          .from('purchase_orders')
          .select('order_number, status')
          .eq('vendor_id', vendor.id)

        console.log(`      POs: ${pos?.length || 0}`)
        if (pos && pos.length > 0) {
          pos.forEach(po => console.log(`         - ${po.order_number} (${po.status})`))
        }
      }
    }

  } catch (error) {
    console.error('❌ Error:', error.message)
  }
}

findAlgeriaVendor()
