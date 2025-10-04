"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const axios_1 = __importDefault(require("axios"));
const env_1 = require("../env");
const API_BASE_URL = `http://localhost:${env_1.env.port}`;
async function runTests() {
    console.log('بدء اختبارات الخدمة الوسيطة...\n');
    try {
        // اختبار صحة الخدمة
        console.log('🔍 اختبار نقطة نهاية الصحة...');
        const healthResponse = await axios_1.default.get(`${API_BASE_URL}/api/test/health`);
        console.log('✅ الخدمة تعمل بشكل صحيح\n');
        // اختبار البيانات المالية
        console.log('🔍 اختبار جلب البيانات المالية...');
        const financialResponse = await axios_1.default.get(`${API_BASE_URL}/api/test/test-financial`);
        console.log('✅ تم جلب البيانات المالية بنجاح');
        console.log('📊 البيانات المستلمة:', JSON.stringify(financialResponse.data, null, 2), '\n');
        // اختبار المزامنة
        console.log('🔍 اختبار عملية المزامنة...');
        const syncResponse = await axios_1.default.post(`${API_BASE_URL}/api/test/sync-test`);
        console.log('✅ تمت المزامنة بنجاح');
        console.log('🔄 نتيجة المزامنة:', JSON.stringify(syncResponse.data, null, 2), '\n');
        console.log('🎉 تم إكمال جميع الاختبارات بنجاح!');
    }
    catch (error) {
        if (error instanceof Error) {
            console.error('❌ حدث خطأ أثناء الاختبار:', error.message);
        }
        if (axios_1.default.isAxiosError(error) && error.response) {
            console.error('📝 تفاصيل الخطأ:', JSON.stringify(error.response.data, null, 2));
        }
        process.exit(1);
    }
}
// تشغيل الاختبارات
runTests();
