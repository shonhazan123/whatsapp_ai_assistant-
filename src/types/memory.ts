// Type definitions for Second Brain Memory system

export interface MemoryRecord {
  id: string;
  user_id: string;
  text: string;
  embedding: number[]; // 1536-dimensional vector
  metadata: {
    tags?: string[];
    category?: string;
    language?: 'hebrew' | 'english' | 'other';
    [key: string]: any;
  };
  created_at: Date;
  updated_at: Date;
}

export interface SearchResult extends MemoryRecord {
  similarity: number; // Cosine similarity score (0-1, higher = more similar)
}

export interface MemoryMetadata {
  tags?: string[];
  category?: string;
  language?: 'hebrew' | 'english' | 'other';
  [key: string]: any;
}

