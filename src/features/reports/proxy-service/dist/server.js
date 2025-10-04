"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const http_proxy_middleware_1 = require("http-proxy-middleware");
const config_1 = require("./config");
const logger_1 = require("./logger");
const test_routes_1 = require("./routes/test.routes");
const app = (0, express_1.default)();
// إعداد CORS
app.use((0, cors_1.default)({
    origin: config_1.environment.cors.allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST']
}));
// إعداد Rate Limiting
const limiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000, // 15 دقيقة
    max: 100 // الحد الأقصى للطلبات لكل IP
});
app.use(limiter);
// ميدلوير المصادقة
const authMiddleware = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'غير مصرح' });
    }
    // تحقق من التوكن مع نظام وردة
    next();
};
// إعداد Proxy لـ Wardah API
const wardahProxy = (0, http_proxy_middleware_1.createProxyMiddleware)({
    target: config_1.environment.wardah.apiEndpoint,
    changeOrigin: true,
    pathRewrite: {
        '^/api/wardah': ''
    },
    onProxyReq: (proxyReq) => {
        // إضافة headers مطلوبة
        proxyReq.setHeader('X-Wardah-Client', 'Gemini-Dashboard');
    }
});
// مسارات API
app.use('/api/wardah/financial', authMiddleware, wardahProxy);
app.use('/api/wardah/accounting', authMiddleware, wardahProxy);
app.use('/api/wardah/reports', authMiddleware, wardahProxy);
// تسجيل مسارات الاختبار
app.use('/api/test', test_routes_1.router);
// مسار خاص بتحديثات البيانات في الوقت الفعلي
app.get('/api/wardah/updates', authMiddleware, (req, res) => {
    // تنفيذ منطق التحديثات في الوقت الفعلي
    res.json({ status: 'success' });
});
// معالجة الأخطاء
app.use((err, req, res, next) => {
    logger_1.logger.error('خطأ في الخدمة الوسيطة:', err);
    res.status(500).json({
        error: 'حدث خطأ داخلي',
        details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});
const PORT = config_1.environment.port || 3001;
app.listen(PORT, () => {
    logger_1.logger.info(`الخدمة الوسيطة تعمل على المنفذ ${PORT}`);
});
