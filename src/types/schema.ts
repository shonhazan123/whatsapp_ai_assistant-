import { z } from 'zod';

/**
 * Zod schemas for data validation
 */

// Task schemas
export const TaskSchema = z.object({
  id: z.string().uuid().optional(),
  user_id: z.string().uuid().optional(),
  text: z.string().min(1),
  category: z.string().optional(),
  due_date: z.string().datetime().optional(),
  completed: z.boolean().default(false),
  created_at: z.string().datetime().optional(),
  recurrence: z.object({
    type: z.enum(['daily', 'weekly', 'monthly']),
    interval: z.number().min(1),
    days: z.array(z.string()).optional(),
    until: z.string().datetime().optional()
  }).optional()
});

export const SubtaskSchema = z.object({
  id: z.string().uuid().optional(),
  task_id: z.string().uuid(),
  text: z.string().min(1),
  completed: z.boolean().default(false),
  created_at: z.string().datetime().optional()
});

// Event schemas
export const EventSchema = z.object({
  id: z.string().optional(),
  summary: z.string().min(1),
  description: z.string().optional(),
  location: z.string().optional(),
  start: z.object({
    dateTime: z.string().datetime().optional(),
    date: z.string().optional(),
    timeZone: z.string().default('Asia/Jerusalem')
  }),
  end: z.object({
    dateTime: z.string().datetime().optional(),
    date: z.string().optional(),
    timeZone: z.string().default('Asia/Jerusalem')
  }),
  attendees: z.array(z.object({
    email: z.string().email(),
    displayName: z.string().optional(),
    responseStatus: z.enum(['needsAction', 'accepted', 'declined', 'tentative']).optional()
  })).optional(),
  recurrence: z.array(z.string()).optional(), // RRULE format
  reminders: z.object({
    useDefault: z.boolean().default(false),
    overrides: z.array(z.object({
      method: z.enum(['email', 'popup']),
      minutes: z.number()
    })).optional()
  }).optional()
});

export const RecurringEventSchema = z.object({
  summary: z.string().min(1),
  startTime: z.string(), // HH:mm format
  endTime: z.string(), // HH:mm format
  days: z.array(z.enum(['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'])),
  until: z.string().datetime().optional(),
  description: z.string().optional(),
  location: z.string().optional()
});

// List schemas
export const ListSchema = z.object({
  id: z.string().uuid().optional(),
  user_id: z.string().uuid().optional(),
  list_name: z.string().min(1),
  content: z.object({
    items: z.array(z.object({
      text: z.string(),
      checked: z.boolean().default(false)
    }))
  }),
  created_at: z.string().datetime().optional()
});

// Email schemas
export const EmailSchema = z.object({
  to: z.array(z.string().email()).min(1),
  subject: z.string().min(1),
  body: z.string().min(1),
  cc: z.array(z.string().email()).optional(),
  bcc: z.array(z.string().email()).optional(),
  attachments: z.array(z.object({
    filename: z.string(),
    content: z.string(), // base64
    contentType: z.string()
  })).optional()
});

// Query schemas
export const QuerySchema = z.object({
  userPhone: z.string().min(1),
  text: z.string().min(1),
  intent: z.string().optional(),
  filters: z.record(z.any()).optional(),
  limit: z.number().optional(),
  offset: z.number().optional()
});

// Candidate schemas (for HITL)
export const CandidateSchema = z.object({
  id: z.string(),
  type: z.enum(['task', 'event', 'list', 'email']),
  label: z.string(),
  data: z.any(),
  confidence: z.number().min(0).max(1),
  metadata: z.record(z.any()).optional()
});

// State schemas for LangGraph
export const AgentStateSchema = z.object({
  messageId: z.string().uuid(),
  userPhone: z.string(),
  messageText: z.string(),
  originalMessage: z.string(),
  intent: z.string(),
  targetAgent: z.string().nullable(),
  candidates: z.array(CandidateSchema),
  selectedCandidateId: z.string().nullable(),
  awaitingUserInput: z.boolean(),
  clarificationMessage: z.string().nullable(),
  executionStatus: z.enum(['pending', 'in_progress', 'awaiting_hitl', 'completed', 'failed']),
  result: z.any(),
  error: z.string().nullable(),
  conversationHistory: z.array(z.object({
    role: z.enum(['system', 'user', 'assistant']),
    content: z.string(),
    timestamp: z.string().optional()
  })),
  previousStates: z.array(z.string()),
  response: z.string().nullable()
});

// Batch operation schemas
export const BatchOperationSchema = z.object({
  operation: z.enum(['create', 'update', 'delete']),
  items: z.array(z.any()),
  batchSize: z.number().default(10),
  delayMs: z.number().default(200),
  requiresHITL: z.boolean().default(false)
});

// Type exports
export type Task = z.infer<typeof TaskSchema>;
export type Subtask = z.infer<typeof SubtaskSchema>;
export type Event = z.infer<typeof EventSchema>;
export type RecurringEvent = z.infer<typeof RecurringEventSchema>;
export type List = z.infer<typeof ListSchema>;
export type Email = z.infer<typeof EmailSchema>;
export type Query = z.infer<typeof QuerySchema>;
export type Candidate = z.infer<typeof CandidateSchema>;
export type AgentState = z.infer<typeof AgentStateSchema>;
export type BatchOperation = z.infer<typeof BatchOperationSchema>;

