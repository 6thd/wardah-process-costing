/**
 * التحقق من هيكل جدول products
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);

async function checkProductsTable() {
  console.log('🔍 التحقق من جدول products...\n');

  try {
    // محاولة إضافة منتج بأقل الحقول الممكنة
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .limit(1);

    if (error) {
      console.error('❌ خطأ:', error.message);
      if (error.details) console.error('التفاصيل:', error.details);
      if (error.hint) console.error('اقتراح:', error.hint);
      return;
    }

    if (data && data.length > 0) {
      console.log('✅ تم العثور على منتجات موجودة:\n');
      console.log('📋 عينة من المنتج الأول:');
      console.log(JSON.stringify(data[0], null, 2));
      console.log('\n📝 الأعمدة المتاحة:');
      console.log(Object.keys(data[0]).join(', '));
    } else {
      console.log('⚠️  الجدول فارغ. جرب إضافة منتج بالحقول الأساسية فقط.');
      
      // محاولة إضافة منتج بسيط
      console.log('\n🧪 محاولة إضافة منتج بسيط...');
      const { data: newProduct, error: insertError } = await supabase
        .from('products')
        .insert({
          code: 'P001',
          name: 'مادة خام - نوع A',
        })
        .select()
        .single();

      if (insertError) {
        console.error('\n❌ فشل الإضافة:', insertError.message);
        console.log('\n💡 الحقول المطلوبة قد تكون:');
        console.log('- code (required)');
        console.log('- name (required)');
        console.log('- وربما حقول إضافية أخرى');
      } else {
        console.log('\n✅ تمت الإضافة! هيكل المنتج:');
        console.log(JSON.stringify(newProduct, null, 2));
        console.log('\n📝 الأعمدة المتاحة:');
        console.log(Object.keys(newProduct).join(', '));
      }
    }
  } catch (error) {
    console.error('❌ خطأ عام:', error.message);
  }
}

checkProductsTable();
