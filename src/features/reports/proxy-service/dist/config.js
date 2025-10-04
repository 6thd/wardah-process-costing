"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.environment = void 0;
const dotenv_1 = require("dotenv");
const path_1 = require("path");
// تحميل المتغيرات البيئية من ملف .env
(0, dotenv_1.config)({ path: (0, path_1.resolve)(__dirname, '.env') });
// القيم الافتراضية للتطوير
const defaults = {
    WARDAH_API_ENDPOINT: 'http://localhost:8000',
    WARDAH_API_KEY: 'dev_key',
    JWT_SECRET: 'dev_secret',
    PROXY_AUTH_KEY: 'dev_proxy_key'
};
// استخدام القيم الافتراضية إذا لم تكن المتغيرات موجودة
for (const [key, value] of Object.entries(defaults)) {
    if (!process.env[key]) {
        process.env[key] = value;
        console.log(`تم تعيين قيمة افتراضية للمتغير ${key} للتطوير`);
    }
}
// تصدير المتغيرات البيئية
exports.environment = {
    nodeEnv: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT || '3001', 10),
    wardah: {
        apiEndpoint: process.env.WARDAH_API_ENDPOINT,
        apiKey: process.env.WARDAH_API_KEY
    },
    cors: {
        allowedOrigins: (process.env.ALLOWED_ORIGINS || 'http://localhost:3000').split(',')
    },
    logging: {
        level: process.env.LOG_LEVEL || 'info',
        file: process.env.LOG_FILE || 'proxy-service.log'
    }
};
;
