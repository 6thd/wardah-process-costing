import { environment } from '../config';

// تعريف الواجهة للمتغيرات البيئية
interface Environment {
    nodeEnv: string;
    port: number;
    wardahApi: string;
    wardahApiKey: string;
    allowedOrigins: string[];
    logLevel: string;
    logFile: string;
}

// تصدير المتغيرات البيئية مع التحقق من النوع
export const env: Environment = {
    nodeEnv: environment.nodeEnv,
    port: environment.port,
    wardahApi: environment.wardah.apiEndpoint,
    wardahApiKey: environment.wardah.apiKey,
    allowedOrigins: environment.cors.allowedOrigins,
    logLevel: environment.logging.level,
    logFile: environment.logging.file
};

export default env;