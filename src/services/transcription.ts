
// src/services/transcription.ts
import { openai } from '../config/openai';
import FormData from 'form-data';
import { Readable } from 'stream';
import { logger } from '../utils/logger';

export async function transcribeAudio(audioBuffer: Buffer): Promise<string> {
  try {
    // Create a File-like object from the buffer
    const audioFile = new File([audioBuffer], 'audio.ogg', { type: 'audio/ogg' });

    const transcription = await openai.audio.transcriptions.create({
      file: audioFile,
      model: 'whisper-1',
      language: 'he' // Hebrew language support
    });

    logger.info('Audio transcribed successfully');
    return transcription.text;
  } catch (error) {
    logger.error('Error transcribing audio:', error);
    throw error;
  }
}