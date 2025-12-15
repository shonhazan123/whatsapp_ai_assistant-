/**
 * Debug script to manually trigger morning digest for a specific user
 * Usage: npx ts-node scripts/debug-morning-digest.ts
 */

// CRITICAL: Load environment variables FIRST before any other imports
import dotenv from 'dotenv';
dotenv.config();

// Import only what we need that doesn't depend on database
import { Pool } from 'pg';
import { logger } from '../src/utils/logger';

const TARGET_PHONE = '+972543911602';
const TIMEOUT_MS = 60000; // 60 seconds timeout

async function debugMorningDigest() {
  try {
    console.log('Step 1: Starting script...');
    logger.info('🔍 Starting morning digest debug for user:', TARGET_PHONE);

    // Check environment variables
    console.log('\n📋 Checking environment variables...');
    const requiredEnvVars = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
    const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
    
    if (missingVars.length > 0) {
      console.error('❌ Missing required environment variables:');
      missingVars.forEach(varName => console.error(`   - ${varName}`));
      console.error('\n💡 Make sure your .env file exists and contains all required variables.');
      console.error('   You can check your setup by running: npm run debug');
      process.exit(1);
    }

    console.log('✅ Environment variables found:');
    console.log(`   DB_HOST: ${process.env.DB_HOST}`);
    console.log(`   DB_NAME: ${process.env.DB_NAME}`);
    console.log(`   DB_USER: ${process.env.DB_USER}`);
    console.log(`   DB_PORT: ${process.env.DB_PORT || '5432'}`);

    console.log('\nStep 2: Testing database connection...');
    logger.info('🔌 Testing database connection...');
    
    // Create a fresh database connection with explicit env vars to avoid import hoisting issues
    const testPool = new Pool({
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      ssl: {
        rejectUnauthorized: false // Required for Supabase
      },
      connectionTimeoutMillis: 10000,
    });

    try {
      await Promise.race([
        testPool.query('SELECT NOW()'),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Database connection timeout after 10 seconds')), 10000)
        )
      ]);
      console.log('✅ Database connection successful');
      logger.info('✅ Database connection successful');
      await testPool.end();
    } catch (error: any) {
      await testPool.end();
      console.error('\n❌ Database connection failed');
      if (error.code === 'ECONNREFUSED') {
        console.error(`   Connection refused to ${process.env.DB_HOST}:${process.env.DB_PORT}`);
        console.error('   This usually means:');
        console.error('   - The database host/port is incorrect');
        console.error('   - The database is not accessible from your network');
        console.error('   - A firewall is blocking the connection');
      } else {
        console.error(`   Error: ${error.message || error.code || error}`);
      }
      console.error('\n💡 Troubleshooting tips:');
      console.error('   1. Verify your .env file has the correct database credentials');
      console.error('   2. Check if your database is accessible (not behind a firewall)');
      console.error('   3. For Supabase: Make sure you\'re using the connection pooler port (usually 6543)');
      console.error('   4. Run "npm run debug" to test your database connection');
      logger.error('❌ Database connection failed. Please check your .env file and database settings.');
      process.exit(1);
    }
    console.log('Step 3: Database connection successful');
    logger.info('✅ Database connection successful');

    console.log('Step 4: Loading ReminderService (using dynamic import to ensure env vars are loaded)...');
    logger.info('📦 Initializing ReminderService...');
    // Use dynamic import to ensure database module is loaded AFTER env vars are set
    const { ReminderService } = await import('../src/services/reminder/ReminderService');
    const reminderService = new ReminderService(logger);
    console.log('Step 5: ReminderService initialized');

    console.log('Step 6: Sending morning digest...');
    logger.info('📋 Sending morning digest...');
    await Promise.race([
      reminderService.sendMorningDigestForUser(TARGET_PHONE),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Morning digest operation timeout after 50 seconds')), 50000)
      )
    ]);
    
    console.log('Step 7: Morning digest sent successfully');
    logger.info('✅ Morning digest sent successfully!');
    
    console.log('Step 8: Closing database pool...');
    const { pool } = await import('../src/config/database');
    await pool.end();
    console.log('Step 9: Database pool closed');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error caught:', error);
    logger.error('❌ Error in morning digest debug:', error);
    if (error instanceof Error) {
      console.error('Error message:', error.message);
      logger.error('Error details:', error.message);
      logger.error('Stack:', error.stack);
    }
    
    // Try to close database pool on error
    try {
      const { pool } = await import('../src/config/database');
      await pool.end();
    } catch (closeError) {
      // Ignore close errors
    }
    
    process.exit(1);
  }
}

// Run the script with overall timeout
const timeout = setTimeout(() => {
  console.error('❌ Script timeout after 60 seconds. The operation may be hanging.');
  console.error('This could indicate:');
  console.error('  - Database connection issues');
  console.error('  - Network connectivity problems');
  console.error('  - Missing environment variables');
  process.exit(1);
}, TIMEOUT_MS);

debugMorningDigest()
  .then(() => {
    clearTimeout(timeout);
  })
  .catch((error) => {
    clearTimeout(timeout);
    console.error('Unhandled error:', error);
    process.exit(1);
  });

