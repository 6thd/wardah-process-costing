import express, { Response, NextFunction, Request } from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { logger } from './logger';
import path from 'path';
import { Router } from 'express';

// إنشاء راوتر للتقارير
const reportsRouter = Router();
reportsRouter.get('/dashboard', (req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});
import { AuthenticatedRequest } from './types';
import { router as testRoutes } from './routes/test.routes';
import { dataRoutes } from './routes/data.routes';
import financialRoutes from './routes/financial.routes';

const app = express();

// إعداد CORS
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true,
  methods: ['GET', 'POST']
}));

// إعداد Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 دقيقة
  max: 100 // الحد الأقصى للطلبات لكل IP
});
app.use(limiter);

// الملفات الساكنة
app.use(express.static(path.join(__dirname, '../public')));

// طرق لوحة المعلومات
app.use('/reports', reportsRouter);
app.use('/api/data', dataRoutes);
app.use('/api', financialRoutes);

// ميدلوير المصادقة
const authMiddleware = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'غير مصرح' });
  }
  // تحقق من التوكن مع نظام وردة
  next();
};

// إعداد Proxy لـ Wardah API
const wardahProxy = createProxyMiddleware({
  target: process.env.WARDAH_API_ENDPOINT || 'http://localhost:8000',
  changeOrigin: true,
  pathRewrite: {
    '^/api/wardah': ''
  },
  onProxyReq: (proxyReq: any) => {
    // إضافة headers مطلوبة
    proxyReq.setHeader('X-Wardah-Client', 'Gemini-Dashboard');
    proxyReq.setHeader('X-Wardah-API-Key', process.env.WARDAH_API_KEY || 'dev_key');
  }
});

// مسارات API
app.use('/api/wardah/financial', authMiddleware, wardahProxy);
app.use('/api/wardah/accounting', authMiddleware, wardahProxy);
app.use('/api/wardah/reports', authMiddleware, wardahProxy);

// تسجيل مسارات الاختبار
app.use('/api/test', testRoutes);

// مسار خاص بتحديثات البيانات في الوقت الفعلي
app.get('/api/wardah/updates', authMiddleware, (req, res) => {
  // تنفيذ منطق التحديثات في الوقت الفعلي
  res.json({ status: 'success' });
});

// معالجة الأخطاء
app.use((err: Error, req: express.Request, res: Response, next: NextFunction) => {
  logger.error('خطأ في الخدمة الوسيطة:', err);
  res.status(500).json({
    error: 'حدث خطأ داخلي',
    details: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

const PORT = parseInt(process.env.PORT || '3001', 10);
app.listen(PORT, () => {
  logger.info(`الخدمة الوسيطة تعمل على المنفذ ${PORT}`);
});