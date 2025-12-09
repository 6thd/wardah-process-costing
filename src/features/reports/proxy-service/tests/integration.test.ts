// NOSONAR - Top-level await is required for test execution
import axios from 'axios';
import { env } from '../env';

const API_BASE_URL = `http://localhost:${env.port}`;

try {
  console.log('بدء اختبارات الخدمة الوسيطة...\n');

  // اختبار صحة الخدمة
  console.log('🔍 اختبار نقطة نهاية الصحة...');
  // NOSONAR - Top-level await is used, response is not needed for health check
  await axios.get(`${API_BASE_URL}/api/test/health`);
  console.log('✅ الخدمة تعمل بشكل صحيح\n');

  // اختبار البيانات المالية
  console.log('🔍 اختبار جلب البيانات المالية...');
  const financialResponse = await axios.get(`${API_BASE_URL}/api/test/test-financial`);
  console.log('✅ تم جلب البيانات المالية بنجاح');
  console.log('📊 البيانات المستلمة:', JSON.stringify(financialResponse.data, null, 2), '\n');

  // اختبار المزامنة
  console.log('🔍 اختبار عملية المزامنة...');
  const syncResponse = await axios.post(`${API_BASE_URL}/api/test/sync-test`);
  console.log('✅ تمت المزامنة بنجاح');
  console.log('🔄 نتيجة المزامنة:', JSON.stringify(syncResponse.data, null, 2), '\n');

  console.log('🎉 تم إكمال جميع الاختبارات بنجاح!');
} catch (error) {
  if (error instanceof Error) {
    console.error('❌ حدث خطأ أثناء الاختبار:', error.message);
  }
  if (axios.isAxiosError(error) && error.response) {
    console.error('📝 تفاصيل الخطأ:', JSON.stringify(error.response.data, null, 2));
  }
  process.exit(1);
}