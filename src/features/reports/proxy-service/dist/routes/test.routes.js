"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.testRoutes = exports.router = void 0;
const express_1 = require("express");
const logger_1 = require("../logger");
exports.router = (0, express_1.Router)();
// اختبار الاتصال
exports.router.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
// اختبار البيانات المالية
exports.router.get('/test-financial', async (req, res) => {
    try {
        const testData = {
            revenue: 150000,
            expenses: 85000,
            profit: 65000,
            period: '2025-Q3',
            departments: ['التصنيع', 'التعبئة', 'التوزيع'],
            metrics: {
                profitMargin: '43.33%',
                operatingCosts: '56.67%'
            }
        };
        logger_1.logger.info('تم جلب بيانات الاختبار المالية بنجاح');
        res.json({ success: true, data: testData });
    }
    catch (error) {
        logger_1.logger.error('خطأ في جلب بيانات الاختبار المالية', { error });
        res.status(500).json({
            success: false,
            error: 'حدث خطأ في جلب البيانات المالية'
        });
    }
});
// اختبار مزامنة البيانات
exports.router.post('/sync-test', async (req, res) => {
    try {
        // محاكاة عملية المزامنة
        await new Promise(resolve => setTimeout(resolve, 1500));
        const syncResult = {
            syncedAt: new Date().toISOString(),
            recordsSynced: 25,
            status: 'completed'
        };
        logger_1.logger.info('تمت عملية المزامنة بنجاح', syncResult);
        res.json({ success: true, data: syncResult });
    }
    catch (error) {
        logger_1.logger.error('خطأ في عملية المزامنة', { error });
        res.status(500).json({
            success: false,
            error: 'فشلت عملية المزامنة'
        });
    }
});
exports.testRoutes = exports.router;
