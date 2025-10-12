#!/usr/bin/env node

const axios = require('axios');
require('dotenv').config();

// Get ngrok URL from .env or use localhost
const baseUrl = process.env.NGROK_URL || 'http://localhost:3000';
const webhookUrl = `${baseUrl}/webhook/whatsapp`;

// Test payload
const testPayload = {
  entry: [{
    changes: [{
      value: {
        messages: [{
          from: "1234567890",
          id: `test_message_${Date.now()}`,
          type: "text",
          text: {
            body: process.argv[2] || "Hello, this is a test message"
          }
        }]
      }
    }]
  }]
};

console.log('🧪 Testing WhatsApp Webhook...\n');
console.log(`📍 URL: ${webhookUrl}`);
console.log(`💬 Message: "${testPayload.entry[0].changes[0].value.messages[0].text.body}"\n`);

axios.post(webhookUrl, testPayload, {
  headers: {
    'Content-Type': 'application/json'
  }
})
.then(response => {
  console.log('✅ Webhook test successful!');
  console.log(`📊 Status: ${response.status}`);
  console.log(`📝 Response: ${response.statusText}\n`);
  console.log('Check your application logs to see the AI response.');
})
.catch(error => {
  console.error('❌ Webhook test failed!');
  if (error.response) {
    console.error(`📊 Status: ${error.response.status}`);
    console.error(`📝 Error: ${error.response.statusText}`);
    console.error(`📄 Data:`, error.response.data);
  } else if (error.request) {
    console.error('No response received from server');
    console.error('Make sure your application is running!');
  } else {
    console.error('Error:', error.message);
  }
  process.exit(1);
});

