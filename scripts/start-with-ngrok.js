#!/usr/bin/env node

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🚀 Starting WhatsApp AI Assistant with ngrok...\n');

// Start the main application
console.log('1. Starting the main application...');
const app = spawn('npm', ['run', 'dev'], {
  stdio: 'inherit',
  shell: true
});

// Wait a moment for the app to start
setTimeout(() => {
  console.log('\n2. Starting ngrok tunnel...');
  
  // Start ngrok
  const ngrok = spawn('ngrok', ['http', '3000'], {
    stdio: 'pipe',
    shell: true
  });

  let ngrokUrl = '';
  
  ngrok.stdout.on('data', (data) => {
    const output = data.toString();
    console.log(output);
    
    // Extract ngrok URL from output
    const urlMatch = output.match(/https:\/\/[a-z0-9-]+\.ngrok\.io/);
    if (urlMatch && !ngrokUrl) {
      ngrokUrl = urlMatch[0];
      console.log(`\n✅ ngrok URL: ${ngrokUrl}`);
      console.log(`📱 WhatsApp Webhook: ${ngrokUrl}/webhook/whatsapp`);
      console.log(`🔐 Google OAuth Callback: ${ngrokUrl}/oauth/callback`);
      console.log('\n📝 Add this to your .env file:');
      console.log(`NGROK_URL=${ngrokUrl}\n`);
    }
    else{
        console.log(`\n❌ ngrok URL: ${ngrokUrl}`);
        console.log(output);
    }
  });

  ngrok.stderr.on('data', (data) => {
    console.error('ngrok error:', data.toString());
  });

  // Handle cleanup
  process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down...');
    app.kill();
    ngrok.kill();
    process.exit(0);
  });

}, 3000);

app.on('error', (err) => {
  console.error('Failed to start application:', err);
});
