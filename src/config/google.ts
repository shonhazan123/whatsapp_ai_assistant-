// src/config/google.ts
import { google } from 'googleapis';
import dotenv from 'dotenv';
dotenv.config();


export const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.NGROK_URL ? `${process.env.NGROK_URL}/oauth/callback` : 'http://localhost:3000/oauth/callback'
);

oauth2Client.setCredentials({
  refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
});

export const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
export const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

