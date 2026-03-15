import type { ResponseWriterInput } from './types.js';
import { write as writeDatabase } from './DatabaseResponseWriter.js';
import { write as writeCalendar } from './CalendarResponseWriter.js';
import { write as writeGmail } from './GmailResponseWriter.js';
import { write as writeSecondBrain } from './SecondBrainResponseWriter.js';
import { write as writeMulti } from './MultiCapabilityResponseWriter.js';

export type { ResponseWriterInput } from './types.js';

const CAPABILITY_WRITERS: Record<string, (input: ResponseWriterInput) => Promise<string>> = {
  database: writeDatabase,
  calendar: writeCalendar,
  gmail: writeGmail,
  secondBrain: writeSecondBrain,
  'second-brain': writeSecondBrain,
  memory: writeSecondBrain,
};

export async function writeResponse(input: ResponseWriterInput): Promise<string> {
  const { formattedResponse } = input;

  const isMultiStep =
    formattedResponse.stepResults && formattedResponse.stepResults.length > 1;

  if (isMultiStep) {
    console.log('[ResponseWriters] Multi-step → MultiCapabilityResponseWriter');
    return writeMulti(input);
  }

  const capability =
    formattedResponse.context?.capability || formattedResponse.agent;

  const writer = CAPABILITY_WRITERS[capability];

  if (writer) {
    console.log(`[ResponseWriters] Single capability "${capability}" → ${capability}ResponseWriter`);
    return writer(input);
  }

  console.log(`[ResponseWriters] Unknown capability "${capability}" → MultiCapabilityResponseWriter (fallback)`);
  return writeMulti(input);
}
