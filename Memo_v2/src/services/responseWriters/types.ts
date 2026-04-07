import type { FormattedResponse } from '../../types/index.js';
import type { LLMStep } from '../../graph/state/MemoState.js';

export interface ResponseWriterInput {
  formattedResponse: FormattedResponse;
  userName?: string;
  requestId?: string;
  userMessage?: string;
  plannerSummary?: string;
}

export interface ResponseWriterOutput {
  text: string;
  llmSteps: LLMStep[];
}
