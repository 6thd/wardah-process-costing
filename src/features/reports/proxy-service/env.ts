import { environment } from './config';

export const env = {
    nodeEnv: environment.nodeEnv,
    port: environment.port,
    wardahApi: environment.wardah.apiEndpoint,
    wardahApiKey: environment.wardah.apiKey,
    allowedOrigins: environment.cors.allowedOrigins,
    logLevel: environment.logging.level,
    logFile: environment.logging.file
};

export default env;