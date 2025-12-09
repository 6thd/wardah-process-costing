import { Router } from 'express';
import { AuthenticatedRequest } from '../types';
import { logger } from '../logger';

export const router = Router();

// اختبار الاتصال
router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// اختبار البيانات المالية
router.get('/test-financial', async (req: AuthenticatedRequest, res) => {
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

    logger.info('تم جلب بيانات الاختبار المالية بنجاح');
    res.json({ success: true, data: testData });
  } catch (error) {
    logger.error('خطأ في جلب بيانات الاختبار المالية', { error });
    res.status(500).json({ 
      success: false, 
      error: 'حدث خطأ في جلب البيانات المالية' 
    });
  }
});

// اختبار مزامنة البيانات
router.post('/sync-test', async (req: AuthenticatedRequest, res) => {
  try {
    // محاكاة عملية المزامنة
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    const syncResult = {
      syncedAt: new Date().toISOString(),
      recordsSynced: 25,
      status: 'completed'
    };

    logger.info('تمت عملية المزامنة بنجاح', syncResult);
    res.json({ success: true, data: syncResult });
  } catch (error) {
    logger.error('خطأ في عملية المزامنة', { error });
    res.status(500).json({
      success: false,
      error: 'فشلت عملية المزامنة'
    });
  }
});

export const testRoutes = router;