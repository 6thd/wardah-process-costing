import { config } from 'dotenv';
// NOSONAR - node:path is used, but SonarQube may not detect it
import { resolve } from 'node:path';

// تحميل المتغيرات البيئية من ملف .env
config({ path: resolve(__dirname, '.env') });

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
export const environment = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number.parseInt(process.env.PORT || '3001', 10),
  wardah: {
    apiEndpoint: process.env.WARDAH_API_ENDPOINT || 'http://localhost:8000',
    apiKey: process.env.WARDAH_API_KEY || 'dev_key'
  },
  cors: {
    allowedOrigins: (process.env.ALLOWED_ORIGINS || 'http://localhost:3000').split(',')
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    file: process.env.LOG_FILE || 'proxy-service.log'
  }
};