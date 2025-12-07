/**
 * Performance Tracking Utilities
 * Helper functions to reduce code repetition for performance tracking
 */

import { RequestContext } from '../../core/context/RequestContext';
import { PerformanceTracker } from './PerformanceTracker';

/**
 * Get requestId from context and set agent name for tracking
 * @param agentName The name of the agent/service making the call
 * @returns The requestId if available, undefined otherwise
 */
export function setAgentNameForTracking(agentName: string): string | undefined {
  const requestContext = RequestContext.get();
  const requestId = requestContext?.performanceRequestId;
  if (requestId) {
    PerformanceTracker.getInstance()['requestContext'].setCurrentAgent(requestId, agentName);
  }
  return requestId;
}

/**
 * Get requestId from context (without setting agent name)
 * @returns The requestId if available, undefined otherwise
 */
export function getRequestId(): string | undefined {
  const requestContext = RequestContext.get();
  return requestContext?.performanceRequestId;
}

