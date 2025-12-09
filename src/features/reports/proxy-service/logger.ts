// @ts-ignore - winston 3.x includes built-in TypeScript types, but TypeScript may not detect them
// NOSONAR - winston 3.x includes built-in TypeScript types
import winston from 'winston';

// تكوين التسجيل
export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    // تسجيل في الملف
    new winston.transports.File({ 
      filename: process.env.LOG_FILE || 'proxy-service.log',
      level: process.env.LOG_LEVEL || 'info'
    }),
    // تسجيل في وحدة التحكم في وضع التطوير
    ...(process.env.NODE_ENV === 'development' ? [
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.simple()
        )
      })
    ] : [])
  ]
});

// تسجيل معلومات بدء التشغيل
logger.info('تم تهيئة نظام التسجيل', {
  level: process.env.LOG_LEVEL || 'info',
  environment: process.env.NODE_ENV || 'development'
});