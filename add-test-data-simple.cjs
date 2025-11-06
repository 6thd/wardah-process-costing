/**
 * إضافة بيانات اختبار بسيطة (مورد وعميل)
 * Simple Test Data Addition
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// قراءة config.json
const configPath = path.join(__dirname, 'config.json');
let config;

try {
  const configData = fs.readFileSync(configPath, 'utf8');
  config = JSON.parse(configData);
} catch (error) {
  console.error('❌ خطأ في قراءة config.json:', error.message);
  process.exit(1);
}

const supabaseUrl = config.SUPABASE_URL;
const supabaseKey = config.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ خطأ: بيانات Supabase غير موجودة في config.json');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function addTestData() {
  console.log('═══════════════════════════════════════════════');
  console.log('   إضافة بيانات اختبار (مورد وعميل)');
  console.log('═══════════════════════════════════════════════\n');

  try {
    // 1. الحصول على org_id من config أو من قاعدة البيانات
    console.log('1️⃣ الحصول على org_id...');
    
    let org_id = config.APP_SETTINGS?.orgId;
    
    // إذا لم يكن موجود في config، نحاول من قاعدة البيانات
    if (!org_id || org_id === '00000000-0000-0000-0000-000000000001') {
      const { data: orgs, error: orgError } = await supabase
        .from('organizations')
        .select('id, name')
        .limit(1);

      if (orgError) {
        console.log(`   ⚠️  تحذير: لا يمكن الوصول لجدول organizations`);
        console.log(`   استخدام org_id الافتراضي من config.json`);
        org_id = '00000000-0000-0000-0000-000000000001';
      } else if (orgs && orgs.length > 0) {
        org_id = orgs[0].id;
        console.log(`   ✅ تم العثور على المنظمة: ${orgs[0].name}`);
      } else {
        console.log(`   ⚠️  استخدام org_id الافتراضي من config.json`);
        org_id = '00000000-0000-0000-0000-000000000001';
      }
    } else {
      console.log(`   ✅ استخدام org_id من config.json`);
    }
    
    console.log(`   📋 Organization ID: ${org_id}\n`);

    // 2. إضافة مورد
    console.log('2️⃣ إضافة مورد تجريبي...');
    const { data: vendor, error: vendorError } = await supabase
      .from('vendors')
      .upsert({
        org_id: org_id,
        code: 'V001',
        name: 'شركة المواد الخام المحدودة',
        contact_person: 'أحمد محمد',
        phone: '0551234567',
        email: 'supplier@materials.com',
        address: 'الرياض، المملكة العربية السعودية',
        tax_number: '300123456700003',
        is_active: true,
      }, {
        onConflict: 'org_id,code'
      })
      .select()
      .single();

    if (vendorError) throw vendorError;
    console.log(`   ✅ تم إضافة المورد: ${vendor.name}`);
    console.log(`   📋 Vendor ID: ${vendor.id}\n`);

    // 3. إضافة عميل
    console.log('3️⃣ إضافة عميل تجريبي...');
    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .upsert({
        org_id: org_id,
        code: 'C001',
        name: 'مؤسسة التجارة الكبرى',
        contact_person: 'خالد أحمد',
        phone: '0557654321',
        email: 'customer@trading.com',
        address: 'جدة، المملكة العربية السعودية',
        tax_number: '300234567800003',
        credit_limit: 50000.00,
        is_active: true,
      }, {
        onConflict: 'org_id,code'
      })
      .select()
      .single();

    if (customerError) throw customerError;
    console.log(`   ✅ تم إضافة العميل: ${customer.name}`);
    console.log(`   📋 Customer ID: ${customer.id}\n`);

    // 4. التحقق من وجود منتج
    console.log('4️⃣ التحقق من المنتجات...');
    const { data: products, error: productsError } = await supabase
      .from('products')
      .select('id, code, name, quantity_on_hand, cost_price')
      .eq('org_id', org_id)
      .limit(1);

    if (productsError) {
      console.log(`   ⚠️  تحذير: جدول products قد لا يكون موجوداً`);
    } else if (!products || products.length === 0) {
      console.log(`   ⚠️  تحذير: لا توجد منتجات. يجب إضافة منتج للاختبار.\n`);
      console.log('   💡 لإضافة منتج تجريبي، نفذ في Supabase:');
      console.log(`   
   INSERT INTO products (
     org_id, code, name, unit_of_measure,
     category, quantity_on_hand, cost_price,
     selling_price, reorder_level, is_active
   ) VALUES (
     '${org_id}',
     'P001',
     'مادة خام - نوع A',
     'kg',
     'raw_materials',
     500.00,
     5.00,
     7.00,
     200.00,
     true
   ) RETURNING id, code, name;
      `);
    } else {
      const product = products[0];
      console.log(`   ✅ تم العثور على منتج: ${product.name}`);
      console.log(`   📋 Product ID: ${product.id}`);
      console.log(`   📦 المخزون: ${product.quantity_on_hand}`);
      console.log(`   💰 التكلفة: ${product.cost_price} SAR\n`);
    }

    // 5. عرض الملخص
    console.log('═══════════════════════════════════════════════');
    console.log('✅ تمت إضافة بيانات الاختبار بنجاح!');
    console.log('═══════════════════════════════════════════════\n');
    console.log('📋 استخدم هذه المعرفات في run-real-test.cjs:\n');
    console.log(`const TEST_IDS = {`);
    console.log(`  org_id: '${org_id}',`);
    console.log(`  vendor_id: '${vendor.id}',`);
    console.log(`  customer_id: '${customer.id}',`);
    if (products && products.length > 0) {
      console.log(`  product_id: '${products[0].id}',`);
    } else {
      console.log(`  product_id: 'ADD_PRODUCT_FIRST', // ← أضف منتج أولاً`);
    }
    console.log(`};\n`);
    
    if (!products || products.length === 0) {
      console.log('⚠️  ملاحظة: يجب إضافة منتج قبل تشغيل الاختبار الكامل');
    } else {
      console.log('✅ جاهز للاختبار! شغّل: node run-real-test.cjs');
    }
    console.log('\n═══════════════════════════════════════════════\n');

  } catch (error) {
    console.error('\n❌ حدث خطأ:', error.message);
    if (error.details) console.error('التفاصيل:', error.details);
    if (error.hint) console.error('اقتراح:', error.hint);
  }
}

addTestData();
