#!/usr/bin/env node

const axios = require('axios');
require('dotenv').config();

const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const ACCESS_TOKEN = process.env.WHATSAPP_API_TOKEN;
const WHATSAPP_API_URL = 'https://graph.facebook.com/v18.0';

console.log('📱 WhatsApp Business API Information\n');
console.log('━'.repeat(50));

async function getPhoneNumberInfo() {
  try {
    const response = await axios.get(
      `${WHATSAPP_API_URL}/${PHONE_NUMBER_ID}`,
      {
        headers: {
          'Authorization': `Bearer ${ACCESS_TOKEN}`
        }
      }
    );

    console.log('\n✅ Phone Number Details:');
    console.log('━'.repeat(50));
    console.log(`📞 Display Phone: ${response.data.display_phone_number}`);
    console.log(`🆔 Phone Number ID: ${response.data.id}`);
    console.log(`✓ Verified: ${response.data.verified_name || 'N/A'}`);
    console.log(`🔢 Quality Rating: ${response.data.quality_rating || 'N/A'}`);
    console.log('\n📝 To chat with your bot:');
    console.log(`   1. Save this number in your phone: ${response.data.display_phone_number}`);
    console.log(`   2. Open WhatsApp and start a conversation`);
    console.log(`   3. Send a message like "Hello"`);
    console.log(`   4. Your bot will respond!\n`);
    
  } catch (error) {
    console.error('\n❌ Error fetching phone number info:');
    if (error.response) {
      console.error(`Status: ${error.response.status}`);
      console.error(`Error: ${JSON.stringify(error.response.data, null, 2)}`);
    } else {
      console.error(error.message);
    }
    console.log('\n💡 Make sure your WHATSAPP_API_TOKEN and WHATSAPP_PHONE_NUMBER_ID are correct in .env');
  }
}

getPhoneNumberInfo();

