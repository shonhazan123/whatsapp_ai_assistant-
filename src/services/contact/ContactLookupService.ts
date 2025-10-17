import { ServiceContainer } from '../../core/container/ServiceContainer';
import { logger } from '../../utils/logger';

export interface ContactMatch {
  id: number;
  name: string;
  email?: string;
  phone?: string;
  similarity: number; // 0-1 score
}

export interface ContactLookupResult {
  success: boolean;
  contacts?: ContactMatch[];
  error?: string;
  requiresUserChoice?: boolean;
}

export class ContactLookupService {
  private container: ServiceContainer;

  constructor(container: ServiceContainer) {
    this.container = container;
  }

  /**
   * Search for contacts by name with fuzzy matching
   */
  async searchContacts(searchName: string, userPhone: string): Promise<ContactLookupResult> {
    try {
      logger.info(`🔍 Searching contacts for: "${searchName}"`);
      
      const contactService = this.container.getContactService();
      
      // Get all contacts for the user
      const allContacts = await contactService.getAll({ userPhone });
      
      if (!allContacts.success || !allContacts.data) {
        return { success: false, error: 'לא נמצאו אנשי קשר' };
      }
      
      // Ensure contacts is an array
      const contacts = Array.isArray(allContacts.data) ? allContacts.data : [];
      
      if (contacts.length === 0) {
        return { success: false, error: 'לא נמצאו אנשי קשר' };
      }
      
      const matches = this.findMatches(searchName, contacts);
      
      logger.info(`📋 Found ${matches.length} potential matches`);
      
      if (matches.length === 0) {
        return { success: false, error: `לא נמצא איש קשר בשם "${searchName}"` };
      }
      
      if (matches.length === 1) {
        return { 
          success: true, 
          contacts: matches,
          requiresUserChoice: false
        };
      }
      
      // Multiple matches - require user choice
      return { 
        success: true, 
        contacts: matches,
        requiresUserChoice: true
      };
      
    } catch (error) {
      logger.error('Error in searchContacts:', error);
      return { success: false, error: 'שגיאה בחיפוש אנשי קשר' };
    }
  }

  /**
   * Find matching contacts using fuzzy string matching
   */
  private findMatches(searchName: string, contacts: any[]): ContactMatch[] {
    const matches: ContactMatch[] = [];
    
    for (const contact of contacts) {
      const similarity = this.calculateSimilarity(searchName.toLowerCase(), contact.name?.toLowerCase() || '');
      
      if (similarity > 0.3) { // Minimum similarity threshold
        matches.push({
          id: contact.id,
          name: contact.name,
          email: contact.email,
          phone: contact.phone,
          similarity
        });
      }
    }
    
    // Sort by similarity (highest first)
    return matches.sort((a, b) => b.similarity - a.similarity);
  }

  /**
   * Calculate string similarity using Levenshtein distance
   */
  private calculateSimilarity(str1: string, str2: string): number {
    if (str1 === str2) return 1.0;
    if (!str1 || !str2) return 0.0;
    
    const maxLen = Math.max(str1.length, str2.length);
    const distance = this.levenshteinDistance(str1, str2);
    
    return (maxLen - distance) / maxLen;
  }

  /**
   * Calculate Levenshtein distance between two strings
   */
  private levenshteinDistance(str1: string, str2: string): number {
    const matrix = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(null));
    
    for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
    for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;
    
    for (let j = 1; j <= str2.length; j++) {
      for (let i = 1; i <= str1.length; i++) {
        const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[j][i] = Math.min(
          matrix[j][i - 1] + 1,     // deletion
          matrix[j - 1][i] + 1,     // insertion
          matrix[j - 1][i - 1] + indicator // substitution
        );
      }
    }
    
    return matrix[str2.length][str1.length];
  }

  /**
   * Format contact matches for user display
   */
  formatContactChoices(contacts: ContactMatch[]): string {
    let message = 'מצאתי מספר אנשי קשר דומים:\n\n';
    
    contacts.forEach((contact, index) => {
      message += `${index + 1}. ${contact.name}`;
      if (contact.email) message += ` (${contact.email})`;
      if (contact.phone) message += ` - ${contact.phone}`;
      message += '\n';
    });
    
    message += '\nאנא בחר מספר (1-' + contacts.length + ') או כתוב "בטל" לביטול.';
    
    return message;
  }

  /**
   * Parse user choice and return selected contact
   */
  parseUserChoice(choice: string, contacts: ContactMatch[]): ContactMatch | null {
    const choiceNum = parseInt(choice);
    
    if (isNaN(choiceNum) || choiceNum < 1 || choiceNum > contacts.length) {
      return null;
    }
    
    return contacts[choiceNum - 1];
  }
}
