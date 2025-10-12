
// src/services/transcription.ts
import { openai } from '../config/openai';
import FormData from 'form-data';
import { Readable } from 'stream';
import { logger } from '../utils/logger';

export async function transcribeAudio(audioBuffer: Buffer): Promise<string> {
  try {
    const formData = new FormData();
    
    // Convert buffer to stream
    const audioStream = Readable.from(audioBuffer);
    formData.append('file', audioStream, {
      filename: 'audio.ogg',
      contentType: 'audio/ogg'
    });
    formData.append('model', 'whisper-1');

    const transcription = await openai.audio.transcriptions.create({
      file: audioStream as any,
      model: 'whisper-1'
    });

    logger.info('Audio transcribed successfully');
    return transcription.text;
  } catch (error) {
    logger.error('Error transcribing audio:', error);
    throw error;
  }
}