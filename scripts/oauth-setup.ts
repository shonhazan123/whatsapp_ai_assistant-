// scripts/oauth-setup.ts
// Run this script to get Google OAuth refresh token
import dotenv from 'dotenv';
import express from 'express';
import { google } from 'googleapis';
import open from 'open';

dotenv.config();

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.NGROK_URL ? `${process.env.NGROK_URL}/oauth/callback` : 'http://localhost:3000/oauth/callback'
);

const scopes = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send'
];

const app = express();
console.log(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET),

app.get('/oauth', (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent'
  });
  res.redirect(url);
});

app.get('/oauth/callback', async (req, res) => {
  const { code } = req.query;
  
  try {
    const { tokens } = await oauth2Client.getToken(code as string);
    
    console.log('\n=== Add this to your .env file ===');
    console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
    console.log('===================================\n');
    
    res.send('Authorization successful! Check your terminal for the refresh token.');
  } catch (error) {
    console.error('Error getting tokens:', error);
    res.send('Error during authorization');
  }
});

app.listen(3000, () => {
  console.log('OAuth server started on http://localhost:3000');
  console.log('Opening browser for authorization...');
  console.log(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);

  const authUrl = process.env.NGROK_URL ? `${process.env.NGROK_URL}/oauth` : 'http://localhost:3000/oauth';
  open(authUrl);
});
