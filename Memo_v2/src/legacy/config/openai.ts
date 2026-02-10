// src/config/openai.ts
import OpenAI from 'openai';
import dotenv from 'dotenv';
dotenv.config();

export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Default model for the application - change this to update all agents using gpt-5.1
export const GPT_5_1_MODEL = 'gpt-5.1';
export const GPT_4O_MINI_MODEL = 'gpt-4o-mini';
export const GPT_5_MINI_MODEL = 'gpt-5-mini';
export const GPT_5_NANO_MODEL = 'gpt-5-nano';

export const DEFAULT_MODEL = GPT_5_1_MODEL