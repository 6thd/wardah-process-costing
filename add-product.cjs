/**
 * إضافة منتج تجريبي
 * Add Test Product
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// قراءة config.json
const configPath = path.join(__dirname, 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);

async function addProduct() {
  console.log('═══════════════════════════════════════════════');
  console.log('   إضافة منتج تجريبي');
  console.log('═══════════════════════════════════════════════\n');

  try {
    const org_id = config.APP_SETTINGS?.orgId || '00000000-0000-0000-0000-000000000001';
    console.log(`📋 Organization ID: ${org_id}\n`);

    // إضافة منتج
    console.log('📦 إضافة منتج تجريبي...');
    const { data: product, error } = await supabase
      .from('products')
      .upsert({
        org_id: org_id,
        code: 'P001',
        name: 'مادة خام - نوع A',
        unit: 'kg',
        stock_quantity: 500.00,
        cost_price: 5.00,
        selling_price: 7.00,
        price: 7.00,
        minimum_stock: 200.00,
      }, {
        onConflict: 'org_id,code'
      })
      .select()
      .single();

    if (error) throw error;

    console.log(`   ✅ تم إضافة المنتج: ${product.name}`);
    console.log(`   📋 Product ID: ${product.id}`);
    console.log(`   📦 المخزون المبدئي: ${product.stock_quantity} ${product.unit}`);
    console.log(`   💰 التكلفة: ${product.cost_price} SAR`);
    console.log(`   💵 سعر البيع: ${product.selling_price} SAR\n`);

    console.log('═══════════════════════════════════════════════');
    console.log('✅ تم إضافة المنتج بنجاح!');
    console.log('═══════════════════════════════════════════════\n');

    return product.id;
  } catch (error) {
    console.error('\n❌ حدث خطأ:', error.message);
    if (error.details) console.error('التفاصيل:', error.details);
    if (error.hint) console.error('اقتراح:', error.hint);
    return null;
  }
}

addProduct();
