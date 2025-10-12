import express from 'express';
import dotenv from 'dotenv';
import { whatsappWebhook } from './routes/webhook';
import { logger } from './utils/logger';
import { testConnection } from './config/database';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// WhatsApp webhook routes
app.use('/webhook', whatsappWebhook);

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

    // Start HTTP server
    app.listen(PORT, () => {
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