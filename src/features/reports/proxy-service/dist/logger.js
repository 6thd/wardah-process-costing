"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
const winston_1 = __importDefault(require("winston"));
const config_1 = require("./config");
// تكوين التسجيل
exports.logger = winston_1.default.createLogger({
    level: config_1.environment.logging.level,
    format: winston_1.default.format.combine(winston_1.default.format.timestamp(), winston_1.default.format.json()),
    transports: [
        // تسجيل في الملف
        new winston_1.default.transports.File({
            filename: config_1.environment.logging.file,
            level: config_1.environment.logging.level
        }),
        // تسجيل في وحدة التحكم في وضع التطوير
        ...(config_1.environment.nodeEnv !== 'production' ? [
            new winston_1.default.transports.Console({
                format: winston_1.default.format.combine(winston_1.default.format.colorize(), winston_1.default.format.simple())
            })
        ] : [])
    ]
});
// تسجيل معلومات بدء التشغيل
exports.logger.info('تم تهيئة نظام التسجيل', {
    level: config_1.environment.logging.level,
    environment: config_1.environment.nodeEnv
});
config_1.environment.nodeEnv;
;
