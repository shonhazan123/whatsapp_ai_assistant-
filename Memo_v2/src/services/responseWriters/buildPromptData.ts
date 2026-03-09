import type { FormattedResponse } from '../../types/index.js';

export function buildPromptData(
  formattedResponse: FormattedResponse,
  userName?: string
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

  const promptData: Record<string, any> = {
    _metadata: metadata,
    ...formattedResponse.formattedData,
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
