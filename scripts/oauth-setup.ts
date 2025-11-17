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

// scripts/database-init.sql
// PostgreSQL initialization script
/*
-- Run this SQL script to set up your database

CREATE DATABASE whatsapp_assistant;

\c whatsapp_assistant;

-- Users table
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    whatsapp_number VARCHAR(20) UNIQUE NOT NULL,
    plan_type TEXT NOT NULL DEFAULT 'standard' CHECK (plan_type IN ('free', 'standard', 'pro')),
    timezone VARCHAR(50) DEFAULT 'Asia/Jerusalem',
    settings JSONB DEFAULT '{}',
    google_email TEXT,
    onboarding_complete BOOLEAN NOT NULL DEFAULT FALSE,
    onboarding_last_prompt_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE user_google_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    access_token TEXT,
    refresh_token TEXT,
    expires_at TIMESTAMP,
    scope TEXT[],
    token_type TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE (user_id, provider)
);

-- Tasks table
CREATE TABLE tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    category VARCHAR(50),
    due_date TIMESTAMP,
    completed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Subtasks table
CREATE TABLE subtasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    completed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Contact list table
CREATE TABLE contact_list (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255),
    phone_number VARCHAR(20),
    email VARCHAR(255),
    address TEXT,
    contact_list_name VARCHAR(100),
    created_at TIMESTAMP DEFAULT NOW()
);

-- Lists table
CREATE TABLE lists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    list_name VARCHAR(50) CHECK (list_name IN ('note', 'checklist')),
    content JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Conversation memory table
CREATE TABLE conversation_memory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_phone VARCHAR(20) NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_tasks_user ON tasks(user_id);
CREATE INDEX idx_subtasks_task ON subtasks(task_id);
CREATE INDEX idx_contact_user ON contact_list(user_id);
CREATE INDEX idx_lists_user ON lists(user_id);
CREATE INDEX idx_conversation_user ON conversation_memory(user_phone, created_at);

-- Function to automatically create user on first message
CREATE OR REPLACE FUNCTION create_user_if_not_exists(phone_number VARCHAR)
RETURNS UUID AS $$
DECLARE
    user_uuid UUID;
BEGIN
    SELECT id INTO user_uuid FROM users WHERE whatsapp_number = phone_number;
    
    IF user_uuid IS NULL THEN
        INSERT INTO users (whatsapp_number) VALUES (phone_number) RETURNING id INTO user_uuid;
    END IF;
    
    RETURN user_uuid;
END;
$$ LANGUAGE plpgsql;
*/

// .gitignore
/*
node_modules/
dist/
.env
.env.local
.env.production
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*
.DS_Store
.vscode/
.idea/
*.swp
*.swo
coverage/
.nyc_output/
*/

// .env.example
/*
# Server Configuration
PORT=3000
NODE_ENV=development

# WhatsApp Business API
WHATSAPP_API_TOKEN=your_whatsapp_token_here
WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id_here
WHATSAPP_WEBHOOK_VERIFY_TOKEN=your_verify_token_here

# OpenAI API
OPENAI_API_KEY=your_openai_api_key_here

# Google OAuth2
GOOGLE_CLIENT_ID=your_google_client_id_here
GOOGLE_CLIENT_SECRET=your_google_client_secret_here
GOOGLE_REDIRECT_URI=https://your-domain.com/auth/google/callback
APP_PUBLIC_URL=https://your-domain.com
GOOGLE_OAUTH_SCOPES=https://www.googleapis.com/auth/calendar,https://www.googleapis.com/auth/gmail.modify,openid,email,profile
JWT_SECRET=change_me_super_secret_value

# Legacy single-user credentials (optional, will be replaced by per-user tokens)
GOOGLE_REFRESH_TOKEN=your_refresh_token_here
GOOGLE_CALENDAR_EMAIL=your_calendar_email@gmail.com
GMAIL_EMAIL=your_gmail@gmail.com

# PostgreSQL Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=whatsapp_assistant
DB_USER=postgres
DB_PASSWORD=your_db_password_here

# Timezone
DEFAULT_TIMEZONE=Asia/Jerusalem
*/

// README.md content
/*
# WhatsApp AI Assistant

A comprehensive WhatsApp bot with AI-powered calendar management, email handling, and task organization.

## Features

- 📱 WhatsApp Business API integration
- 🗓️ Google Calendar management
- 📧 Gmail integration (read, send, reply)
- 🎤 Audio transcription (voice messages)
- 💾 PostgreSQL database for tasks & contacts
- 🧠 Conversation memory
- 🤖 OpenAI GPT-4o powered agents

## Quick Start

1. Install dependencies:
   ```bash
   npm install
   ```

2. Set up environment variables (copy .env.example to .env)

3. Initialize database:
   ```bash
   psql -U postgres < scripts/database-init.sql
   ```

4. Run OAuth setup (get Google refresh token):
   ```bash
   npm run oauth-setup
   ```

5. Start development server:
   ```bash
   npm run dev
   ```

## API Endpoints

- `GET /health` - Health check
- `GET /webhook/whatsapp` - Webhook verification
- `POST /webhook/whatsapp` - Message handler

## Project Structure

```
src/
├── agents/          # AI agent implementations
├── config/          # Configuration files
├── routes/          # Express routes
├── services/        # Business logic services
├── types/           # TypeScript type definitions
└── utils/           # Utility functions
```

## Deployment

For production deployment:

1. Use HTTPS (required for WhatsApp webhooks)
2. Set NODE_ENV=production
3. Use managed PostgreSQL database
4. Implement rate limiting
5. Add monitoring and logging

## License

MIT
*/