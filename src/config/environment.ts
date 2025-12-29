import dotenv from 'dotenv';

dotenv.config();

export type Environment = 'PRODUCTION' | 'DEBUG';

const environment = (process.env.ENVIRONMENT || 'PRODUCTION').toUpperCase() as Environment;

if (environment !== 'PRODUCTION' && environment !== 'DEBUG') {
  throw new Error(`Invalid ENVIRONMENT: ${environment}. Must be 'PRODUCTION' or 'DEBUG'`);
}

export const ENVIRONMENT: Environment = environment;
export const DEBUG_INSTANCE_URL: string | undefined = process.env.DEBUG_INSTANCE_URL;
export const DEBUG_PHONE_NUMBER = '+972543911602';

if (ENVIRONMENT === 'PRODUCTION' && !DEBUG_INSTANCE_URL) {
  console.warn('⚠️  WARNING: ENVIRONMENT is PRODUCTION but DEBUG_INSTANCE_URL is not set');
}

