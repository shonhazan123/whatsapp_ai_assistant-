/**
 * Memo V2 - LangGraph Entry Point
 *
 * This file provides the main export for Memo V2.
 * It can be imported from V1's webhook.ts to enable gradual migration.
 *
 * Usage in V1:
 * ```typescript
 * // src/routes/webhook.ts
 * import { invokeMemoGraph } from '../../Memo_v2/src/index';
 *
 * // Replace processMessageV2 with invokeMemoGraph
 * const response = await invokeMemoGraph(userPhone, messageText, {
 *   whatsappMessageId: message.id,
 *   replyToMessageId: replyToMessageId,
 *   triggerType: 'user'
 * });
 * ```
 */

// Main graph invocation
export {
    buildMemoGraph,
    checkpointer,
    hasPendingInterrupt,
    invokeMemoGraph,
    invokeMemoGraphSimple,
    type InvokeResult
} from "./graph/index.js";

// Media handlers (image and audio; memory lives in Memo V2 only)
export {
    processAudioMessage,
    processImageMessage
} from "./handlers/mediaHandlers.js";

// State types (using Annotation API)
export {
    MemoStateAnnotation,
    createInitialState
} from "./graph/state/MemoState.js";
export type { ExecutionMetadata, MemoState } from "./graph/state/MemoState.js";

// Type exports
export type {
    ConversationMessage,
    DisambiguationContext,
    ExecutionResult,
    FormattedResponse,
    InterruptPayload,
    InterruptType,
    MessageInput,
    PlanStep,
    PlannerOutput,
    ResolverResult,
    TimeContext,
    TriggerInput,
    TriggerType,
    UserContext
} from "./types/index.js";

// Config exports
export {
    DEFAULT_NODE_MODELS,
    LLM_CAPABILITIES,
    getModelConfig,
    getNodeModel,
    validateModelForNode
} from "./config/llm-config.js";

// Utility exports
export {
    FuzzyMatcher,
    QueryResolverAdapter,
    TimeParser,
    getTimeContextString,
    prependTimeContext,
    type EntityDomain,
    type FuzzyMatch,
    type ResolutionCandidate,
    type ResolutionResult
} from "./utils/index.js";

// Service adapter exports
export {
    CalendarServiceAdapter,
    GmailServiceAdapter,
    ListServiceAdapter,
    SecondBrainServiceAdapter,
    TaskServiceAdapter
} from "./services/adapters/index.js";

// WhatsApp service (all sends use Memo_v2 memory with message ID for reply context)
export {
    downloadWhatsAppMedia, markMessageAsRead, sendTypingIndicator, sendWhatsAppMessage
} from "./services/whatsapp.js";

// Executor exports
export {
    BaseExecutor,
    CalendarExecutor,
    DatabaseExecutor,
    EXECUTOR_REGISTRY,
    GeneralExecutor,
    GmailExecutor,
    SecondBrainExecutor,
    createCalendarExecutor,
    createDatabaseExecutor,
    createGeneralExecutor,
    createGmailExecutor,
    createSecondBrainExecutor,
    findExecutor,
    type ExecutorContext
} from "./graph/executors/index.js";

// Version info
export const VERSION = "2.0.0";
export const LANGGRAPH_VERSION = "0.2.x";
