// src/config/database.ts
import { Pool } from 'pg';
import { logger } from '../utils/logger';

export const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: {
    rejectUnauthorized: false // Required for Supabase
  },
  max: 20, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
  connectionTimeoutMillis: 10000, // Return an error after 10 seconds if connection could not be established
});

pool.on('error', (err) => {
  logger.error('Unexpected database error:', err);
});

pool.on('connect', () => {
  logger.info('Database connected successfully');
});

export async function query(text: string, params?: any[]) {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    logger.debug('Executed query', { duration, rows: res.rowCount });
    return res;
  } catch (error) {
    logger.error('Database query error:', error);
    throw error;
  }
}

// Test connection on startup
export async function testConnection(): Promise<boolean> {
  try {
    await pool.query('SELECT NOW()');
    logger.info('Database connection test successful');
    return true;
  } catch (error) {
    logger.error('Database connection test failed:', error);
    return false;
  }
}

