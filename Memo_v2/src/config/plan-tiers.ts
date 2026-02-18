/**
 * Canonical subscription-tier pricing and features.
 * Source: https://donnai.io/pricing
 * Used by MetaResolver to answer "what plan am I on / what does it include?"
 */

export interface PlanTierConfig {
  name: string;
  nameHebrew?: string;
  price: string;
  currency: string;
  period?: string;
  features: string[];
  featuresHebrew?: string[];
}

export const PLAN_TIERS: Record<string, PlanTierConfig> = {
  free: {
    name: 'Free / Trial',
    nameHebrew: 'חינם / ניסיון',
    price: '0',
    currency: 'ILS',
    period: 'month',
    features: [
      'Limited features during trial',
      'WhatsApp support',
    ],
    featuresHebrew: [
      'יכולות מוגבלות בתקופת הניסיון',
      'תמיכה ב-WhatsApp',
    ],
  },
  standard: {
    name: 'Basic',
    nameHebrew: 'בסיסי',
    price: '21',
    currency: 'ILS',
    period: 'month',
    features: [
      'Morning briefing',
      'Personal memory (Second Brain)',
      'Calendar management',
      'Voice recordings',
      'Google Calendar sync',
      'WhatsApp support',
      'Multiple lists',
      'Unlimited reminders',
    ],
    featuresHebrew: [
      'תדרוך בוקר',
      'זיכרון אישי',
      'ניהול יומן',
      'הקלטות קוליות',
      'סנכרון עם Google Calendar',
      'תמיכה ב-WhatsApp',
      'רשימות מרובות',
      'תזכורות ללא הגבלה',
    ],
  },
  pro: {
    name: 'Professional',
    nameHebrew: 'מקצועי',
    price: '28',
    currency: 'ILS',
    period: 'month',
    features: [
      'Priority support',
      'Personal memory',
      'Nudges',
      'Smart reminders',
      'Goal planning',
      'Image analysis (Image to Action)',
      'Full dashboard',
      'Gmail sync',
      'Everything in Basic',
    ],
    featuresHebrew: [
      'עדיפות בתמיכה',
      'זיכרון אישי',
      'נודניקים',
      'תזכורות חכמות',
      'תכנון מטרות והצבת יעדים',
      'ניתוח תמונות',
      'לוח בקרה מלא',
      'סנכרון עם Gmail',
      'כל מה שבבסיסי',
    ],
  },
  business: {
    name: 'Business',
    nameHebrew: 'עסקי',
    price: '42',
    currency: 'ILS',
    period: 'month',
    features: [
      'Create spreadsheets in Google Sheets',
      'Create documents in Google Docs',
      'Google Drive sync',
      'Search in Google Docs / Google Sheets',
      'Google Workspace integration',
      'Everything in Professional',
    ],
    featuresHebrew: [
      'יצירת גיליונות ב-Google Sheets',
      'יצירת מסמכים ב-Google Docs',
      'סנכרון עם Google Drive',
      'חיפוש מידע ב-Google Docs / Google Sheets',
      'אינטגרציית Google Workspace',
      'כל מה שבמקצועי',
    ],
  },
};

export function getPlanTiers(): Record<string, PlanTierConfig> {
  return PLAN_TIERS;
}

export function getPlanTier(tier: string): PlanTierConfig | undefined {
  return PLAN_TIERS[tier];
}
