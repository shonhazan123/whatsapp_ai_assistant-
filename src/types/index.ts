// src/types/index.ts
export interface WhatsAppMessage {
    from: string;
    id: string;
    timestamp: string;
    type: 'text' | 'audio' | 'image' | 'document';
    text?: {
      body: string;
    };
    audio?: {
      id: string;
      mime_type: string;
    };
    image?: {
      id: string;
      mime_type: string;
      sha256: string;
      caption?: string; // Optional user caption with the image
    };
    context?: {
      from: string;
      id: string; // message_id of the message being replied to
      referred_product?: any;
    };
  }
  
  export interface WhatsAppWebhookPayload {
    object: string;
    entry: Array<{
      id: string;
      changes: Array<{
        value: {
          messaging_product: string;
          metadata: {
            display_phone_number: string;
            phone_number_id: string;
          };
          contacts?: Array<{
            profile: {
              name: string;
            };
            wa_id: string;
          }>;
          messages?: WhatsAppMessage[];
        };
        field: string;
      }>;
    }>;
  }
  
  export interface ConversationMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
  }
  
  export interface CalendarEvent {
    id?: string;
    summary: string;
    start: string;
    end: string;
    attendees?: string[];
    reminders?: boolean;
  }
  
  export interface Email {
    id: string;
    threadId: string;
    from: string;
    subject: string;
    snippet: string;
    date: string;
  }
  
  export interface Task {
    id: string;
    userId: string;
    text: string;
    category?: string;
    dueDate?: Date;
    completed: boolean;
  }
  
  export interface AgentResponse {
    success: boolean;
    message: string;
    data?: any;
  }
  
  export interface ToolCall {
    name: string;
    parameters: Record<string, any>;
  }