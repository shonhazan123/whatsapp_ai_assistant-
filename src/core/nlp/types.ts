/**
 * NLP types for intent detection and task decomposition
 */

export interface Intent {
  category: string; // 'task', 'event', 'email', 'contact', 'list', 'planning', 'general'
  action: string; // 'create', 'update', 'delete', 'read', 'search'
  confidence: number; // 0-1
  entities: Entity[];
  requiresResolution: boolean; // Does it need QueryResolver?
  requiresHITL: boolean; // Does it need human confirmation?
}

export interface Entity {
  type: EntityType;
  value: string;
  raw: string; // Original text
  confidence: number;
}

export type EntityType = 
  | 'task_text'
  | 'event_summary'
  | 'datetime'
  | 'date_range'
  | 'recurrence'
  | 'contact_name'
  | 'email_address'
  | 'phone_number'
  | 'list_name'
  | 'category'
  | 'location'
  | 'id';

export interface DecomposedTask {
  id: string;
  description: string;
  type: 'task' | 'event' | 'email' | 'contact' | 'list';
  action: 'create' | 'update' | 'delete' | 'read';
  params: Record<string, any>;
  dependencies: string[]; // IDs of tasks that must complete first
  priority: number; // 1-10
}

export interface DecompositionResult {
  tasks: DecomposedTask[];
  requiresParallel: boolean;
  requiresHITL: boolean;
  estimatedDuration: number; // seconds
}

