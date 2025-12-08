// src/config/openai.ts
import OpenAI from 'openai';
import dotenv from 'dotenv';
dotenv.config();

export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Default model for the application - change this to update all agents using gpt-5.1
export const DEFAULT_MODEL = 'gpt-5.1';