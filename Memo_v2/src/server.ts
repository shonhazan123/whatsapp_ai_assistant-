import dotenv from 'dotenv';
import express, { Request, Response } from 'express';
import { testConnection } from './legacy/config/database';
import { ENVIRONMENT } from './config/environment';
import { authRouter } from './routes/auth';
import { debugRouter } from './routes/debug';
import { whatsappWebhook } from './routes/webhook';
import { SchedulerService } from './jobs/scheduler/SchedulerService.js';
import { logger } from './legacy/utils/logger';

dotenv.config();

process.stdout.write(`[TRACE] ${new Date().toISOString()} Server starting ENVIRONMENT=${ENVIRONMENT}\n`);
logger.info(`[TRACE] Server starting ENVIRONMENT=${ENVIRONMENT}`);

const app = express();
const PORT = process.env.PORT || 3000;

// [TRACE] Log EVERY incoming request - first thing, before body parsing
app.use((req, _res, next) => {
  const ts = new Date().toISOString();
  process.stdout.write(`[TRACE] ${ts} INCOMING ${req.method} ${req.path}\n`);
  logger.info(`[TRACE] INCOMING ${req.method} ${req.path}`);
  next();
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// [TRACE] Log after body parsed (for POST with body)
app.use((req, _res, next) => {
  if (req.method === 'POST' && req.path.includes('debug')) {
    process.stdout.write(`[TRACE] ${new Date().toISOString()} POST body keys: ${Object.keys(req.body || {}).join(', ')}\n`);
    logger.info(`[TRACE] POST ${req.path} body received`);
  }
  next();
});

// Health check endpoint
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Auth routes
app.use('/auth', authRouter);

// Debug routes (only accessible in DEBUG environment)
app.use('/api/debug', debugRouter);

// WhatsApp webhook routes (only registered in PRODUCTION)
if (ENVIRONMENT === 'PRODUCTION') {
  app.use('/webhook', whatsappWebhook);
  logger.info('✅ WhatsApp webhook routes registered (PRODUCTION mode)');
} else {
  logger.info('⚠️  WhatsApp webhook routes skipped (DEBUG mode)');
}

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server with database connection test
async function startServer() {
  try {
    // Test database connection
    const dbConnected = await testConnection();
    if (dbConnected) {
      logger.info('✅ Database connected successfully');
    } else {
      logger.warn('⚠️  Database connection failed - running without conversation memory');
    }

    // Initialize and start reminder scheduler
    const schedulerService = new SchedulerService();
    schedulerService.start();

    // Start HTTP server
    app.listen(PORT, () => {
      process.stdout.write(`[TRACE] ${new Date().toISOString()} Server LISTENING on port ${PORT}\n`);
      logger.info(`🚀 Server running on port ${PORT}`);
      logger.info(`📱 Webhook URL: http://localhost:${PORT}/webhook/whatsapp`);
      logger.info(`🔗 ngrok URL: ${process.env.NGROK_URL || 'Not set'}`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

export default app;