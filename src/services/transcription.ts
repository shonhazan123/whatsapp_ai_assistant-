
// src/services/transcription.ts
import { openai } from '../config/openai';
import { PerformanceTracker } from '../services/performance/PerformanceTracker';
import { setAgentNameForTracking } from '../services/performance/performanceUtils';
import { logger } from '../utils/logger';

export async function transcribeAudio(audioBuffer: Buffer): Promise<string> {
  const transcriptionStartTime = Date.now();
  const performanceTracker = PerformanceTracker.getInstance();
  const trackingRequestId = setAgentNameForTracking('audio_transcription');
  
  try {
    // Create a File-like object from the buffer
    const audioFile = new File([audioBuffer], 'audio.ogg', { type: 'audio/ogg' });

    const transcription = await openai.audio.transcriptions.create({
      file: audioFile,
      model: 'whisper-1',
      language: 'he' // Hebrew language support
    });

    // Track successful transcription
    if (trackingRequestId) {
      // Whisper API doesn't return usage, estimate based on audio duration
      // Rough estimate: ~1 token per second of audio
      const estimatedTokens = Math.ceil(audioBuffer.length / 1000); // Rough estimate
      
      const aiCallInfo = {
        model: 'whisper-1',
        requestTokens: estimatedTokens,
        responseTokens: transcription.text.length / 4, // Rough estimate: ~1 token per 4 chars
        totalTokens: estimatedTokens + Math.ceil(transcription.text.length / 4),
      };
      
      // Store last AI call info
      performanceTracker['requestContext'].setLastAICall(trackingRequestId, aiCallInfo);
      
      await performanceTracker.logAICall(trackingRequestId, {
        callType: 'transcription',
        ...aiCallInfo,
        startTime: transcriptionStartTime,
        endTime: Date.now(),
        responseContent: transcription.text.substring(0, 1000),
        success: true,
        error: null,
        metadata: {
          method: 'transcribeAudio',
          audioSize: audioBuffer.length,
          language: 'he',
        },
      });
    }

    logger.info('Audio transcribed successfully');
    return transcription.text;
  } catch (error) {
    // Track failed transcription
    if (trackingRequestId) {
      await performanceTracker.logAICall(trackingRequestId, {
        callType: 'transcription',
        model: 'whisper-1',
        requestTokens: 0,
        responseTokens: 0,
        totalTokens: 0,
        startTime: transcriptionStartTime,
        endTime: Date.now(),
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        metadata: {
          method: 'transcribeAudio',
          audioSize: audioBuffer.length,
        },
      });
    }
    
    logger.error('Error transcribing audio:', error);
    throw error;
  }
}