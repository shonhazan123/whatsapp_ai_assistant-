import type { FormattedResponse } from '../../types/index.js';

export interface BuildPromptDataOptions {
  userMessage?: string;
  plannerSummary?: string;
}

export function buildPromptData(
  formattedResponse: FormattedResponse,
  userName?: string,
  options?: BuildPromptDataOptions,
): Record<string, any> {
  const isMultiStep =
    formattedResponse.stepResults && formattedResponse.stepResults.length > 1;

  const metadata: Record<string, any> = {
    agent: formattedResponse.agent,
    entityType: formattedResponse.entityType,
    operation: formattedResponse.operation,
    context: formattedResponse.context,
    isMultiStep,
  };

  if (userName != null && userName !== '') {
    metadata.userName = userName;
    const startWithUserName = Math.random() < 0.5;
    metadata.startWithUserName = startWithUserName;
  }

  if (options?.userMessage) {
    metadata.userMessage = options.userMessage;
  }
  if (options?.plannerSummary) {
    metadata.plannerSummary = options.plannerSummary;
  }

  // Normalize formattedData: if it's a single-element array wrapping an object
  // (common for single-step results), unwrap to a plain object so writers can
  // reference data.events / data.searchCriteria directly.
  let dataToSpread = formattedResponse.formattedData;
  if (
    Array.isArray(dataToSpread) &&
    dataToSpread.length === 1 &&
    dataToSpread[0] &&
    typeof dataToSpread[0] === 'object'
  ) {
    dataToSpread = dataToSpread[0];
  }

  const promptData: Record<string, any> = {
    _metadata: metadata,
    ...(typeof dataToSpread === 'object' && dataToSpread !== null ? dataToSpread : {}),
  };

  if (isMultiStep && formattedResponse.stepResults) {
    promptData.stepResults = formattedResponse.stepResults.map((sr) => ({
      capability: sr.capability,
      action: sr.action,
      data: sr.data,
      context:
        sr.context[sr.capability as keyof typeof sr.context] || sr.context,
    }));
  }

  return promptData;
}
