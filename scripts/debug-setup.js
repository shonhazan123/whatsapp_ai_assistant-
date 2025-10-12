#!/usr/bin/env node

const axios = require('axios');
require('dotenv').config();

console.log('🔍 WhatsApp Bot Debug Report\n');
console.log('═'.repeat(60));

// Check environment variables
console.log('\n1️⃣ ENVIRONMENT VARIABLES');
console.log('─'.repeat(60));

const requiredVars = [
  'WHATSAPP_API_TOKEN',
  'WHATSAPP_PHONE_NUMBER_ID',
  'WHATSAPP_WEBHOOK_VERIFY_TOKEN',
  'OPENAI_API_KEY',
  'DB_HOST',
  'DB_NAME',
  'NGROK_URL'
];

let missingVars = [];
requiredVars.forEach(varName => {
  const value = process.env[varName];
  if (value) {
    const displayValue = varName.includes('TOKEN') || varName.includes('KEY') 
      ? `${value.substring(0, 10)}...` 
      : value;
    console.log(`✅ ${varName}: ${displayValue}`);
  } else {
    console.log(`❌ ${varName}: MISSING`);
    missingVars.push(varName);
  }
});

// Check WhatsApp API connection
console.log('\n2️⃣ WHATSAPP API CONNECTION');
console.log('─'.repeat(60));

async function checkWhatsAppAPI() {
  try {
    const response = await axios.get(
      `https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}`,
      {
        headers: {
          'Authorization': `Bearer ${process.env.WHATSAPP_API_TOKEN}`
        }
      }
    );
    console.log(`✅ WhatsApp API: Connected`);
    console.log(`📞 Phone Number: ${response.data.display_phone_number}`);
    console.log(`✓ Verified Name: ${response.data.verified_name}`);
    console.log(`🔢 Quality: ${response.data.quality_rating}`);
    return true;
  } catch (error) {
    console.log(`❌ WhatsApp API: Failed`);
    if (error.response) {
      console.log(`   Error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
    } else {
      console.log(`   Error: ${error.message}`);
    }
    return false;
  }
}

// Check local server
console.log('\n3️⃣ LOCAL SERVER');
console.log('─'.repeat(60));

async function checkLocalServer() {
  try {
    const response = await axios.get('http://localhost:3000/health', { timeout: 3000 });
    console.log(`✅ Local Server: Running`);
    console.log(`   Status: ${response.data.status}`);
    return true;
  } catch (error) {
    console.log(`❌ Local Server: Not responding`);
    console.log(`   Make sure you run: npm run dev`);
    return false;
  }
}

// Check ngrok
console.log('\n4️⃣ NGROK TUNNEL');
console.log('─'.repeat(60));

async function checkNgrok() {
  if (!process.env.NGROK_URL) {
    console.log(`⚠️  NGROK_URL not set in .env`);
    return false;
  }
  
  try {
    const response = await axios.get(`${process.env.NGROK_URL}/health`, { timeout: 5000 });
    console.log(`✅ ngrok Tunnel: Working`);
    console.log(`   URL: ${process.env.NGROK_URL}`);
    console.log(`   Webhook: ${process.env.NGROK_URL}/webhook/whatsapp`);
    return true;
  } catch (error) {
    console.log(`❌ ngrok Tunnel: Not accessible`);
    console.log(`   URL: ${process.env.NGROK_URL}`);
    console.log(`   Make sure ngrok is running: ngrok http 3000`);
    return false;
  }
}

// Check OpenAI
console.log('\n5️⃣ OPENAI API');
console.log('─'.repeat(60));

async function checkOpenAI() {
  if (!process.env.OPENAI_API_KEY) {
    console.log(`❌ OPENAI_API_KEY: Not set`);
    return false;
  }
  
  try {
    const response = await axios.get('https://api.openai.com/v1/models', {
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      timeout: 5000
    });
    console.log(`✅ OpenAI API: Connected`);
    return true;
  } catch (error) {
    console.log(`❌ OpenAI API: Failed`);
    if (error.response) {
      console.log(`   Error: ${error.response.status}`);
    } else {
      console.log(`   Error: ${error.message}`);
    }
    return false;
  }
}

// Check Database
console.log('\n6️⃣ DATABASE CONNECTION');
console.log('─'.repeat(60));

async function checkDatabase() {
  const { Pool } = require('pg');
  const pool = new Pool({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });

  try {
    await pool.query('SELECT NOW()');
    console.log(`✅ Database: Connected`);
    console.log(`   Host: ${process.env.DB_HOST}`);
    console.log(`   Database: ${process.env.DB_NAME}`);
    await pool.end();
    return true;
  } catch (error) {
    console.log(`❌ Database: Failed`);
    console.log(`   Error: ${error.message}`);
    await pool.end();
    return false;
  }
}

// Run all checks
async function runAllChecks() {
  const whatsappOk = await checkWhatsAppAPI();
  const serverOk = await checkLocalServer();
  const ngrokOk = await checkNgrok();
  const openaiOk = await checkOpenAI();
  const dbOk = await checkDatabase();

  console.log('\n═'.repeat(60));
  console.log('📊 SUMMARY');
  console.log('═'.repeat(60));
  
  const allOk = whatsappOk && serverOk && ngrokOk && openaiOk && dbOk;
  
  if (allOk) {
    console.log('\n✅ All systems operational!');
    console.log('\n📱 To test, send a message to your WhatsApp Business number');
    console.log('   from your registered phone number.');
  } else {
    console.log('\n⚠️  Some issues detected. Please fix the errors above.');
    
    if (!serverOk) {
      console.log('\n🔧 Quick fix: Run "npm run dev" in another terminal');
    }
    if (!ngrokOk) {
      console.log('\n🔧 Quick fix: Run "ngrok http 3000" and update NGROK_URL in .env');
    }
    if (missingVars.length > 0) {
      console.log(`\n🔧 Quick fix: Add missing variables to .env: ${missingVars.join(', ')}`);
    }
  }
  
  console.log('\n');
}

runAllChecks().catch(console.error);

