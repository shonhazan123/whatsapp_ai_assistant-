import type { FormattedResponse } from '../../types/index.js';

export interface ResponseWriterInput {
  formattedResponse: FormattedResponse;
  userName?: string;
  requestId?: string;
  userMessage?: string;
  plannerSummary?: string;
}
