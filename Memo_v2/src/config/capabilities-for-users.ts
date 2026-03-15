/**
 * Canonical user-facing capability descriptions for "what can you do?" / describe_capabilities / help.
 * GeneralResolver uses the STATIC block (all capabilities) in the system prompt for token caching;
 * the user message only indicates which capabilities are enabled for this user.
 * Keep in sync with Memo_v2/docs/capabilities/*.md (purpose + boundaries).
 */

export interface EnabledCapabilities {
  calendar?: boolean;
  gmail?: boolean;
  database?: boolean;
  secondBrain?: boolean;
}

/** Short descriptions per capability (EN + HE). Used to build reference blocks. */
const CAPABILITY_BLURBS: Record<
  keyof EnabledCapabilities,
  { en: string; he: string }
> = {
  calendar: {
    en:
      'Calendar (Google): Create, list, update, and delete events; recurring events; all-day and timed events; check conflicts; bulk operations by date range.',
    he:
      'יומן (גוגל): יצירת אירועים, הצגת רשימה, עדכון ומחיקה; אירועים חוזרים; אירועים לכל היום או עם שעה; בדיקת התנגשויות; פעולות לפי טווח תאריכים.',
  },
  gmail: {
    en:
      'Gmail: Search and list emails, read threads, send new emails, reply and forward, mark read/unread, manage labels and archive.',
    he:
      'גימייל: חיפוש ורשימת מיילים, קריאת שרשורים, שליחת מיילים חדשים, מענה והעברה, סימון נקרא/לא נקרא, תוויות וארכוב.',
  },
  database: {
    en:
      'Tasks & reminders: Create tasks and reminders (one-time or recurring, including nudge reminders); lists and checklists; complete, update, delete; bulk operations.',
    he:
      'משימות ותזכורות: יצירת משימות ותזכורות (פעם אחת או חוזרות, כולל תזכורות נודג\'); רשימות ורשימות סימון; סיום, עדכון, מחיקה; פעולות מרובות.',
  },
  secondBrain: {
    en:
      'Second brain (memory): Store notes, contacts, and key-value facts; semantic search over your memories; update and delete; conflict detection when updating existing info.',
    he:
      'מוח שני (זיכרון): שמירת הערות, אנשי קשר ועובדות; חיפוש סמנטי בזיכרונות; עדכון ומחיקה; זיהוי התנגשויות בעדכון מידע קיים.',
  },
};

/**
 * Returns the full capabilities reference for ALL capabilities (static, cacheable).
 * Used in the GeneralResolver SYSTEM PROMPT so it can be cached; the user message
 * indicates which capabilities are enabled for this user, and the model lists only those.
 */
export function getCapabilitiesReferenceStatic(): string {
  const lines: string[] = [
    'When the user asks "what can you do?" / help / describe_capabilities, list only the capabilities that are enabled for this user (see User section in the user message). Use the descriptions below. Do not invent features.',
    '',
  ];
  const keys = ['calendar', 'gmail', 'database', 'secondBrain'] as const;
  for (const key of keys) {
    const blurb = CAPABILITY_BLURBS[key];
    lines.push(`- **${key}**: ${blurb.en}`);
    lines.push(`  (HE: ${blurb.he})`);
    lines.push('');
  }
  return lines.join('\n').trim();
}

/**
 * Returns the canonical capabilities reference text for the given enabled capabilities.
 * Use when building a per-request user message (avoids caching); prefer system-prompt
 * static reference + "Enabled capabilities" in user message for token caching.
 */
export function getCapabilitiesReference(enabled: EnabledCapabilities): string {
  const lines: string[] = [];
  const keys = ['calendar', 'gmail', 'database', 'secondBrain'] as const;
  for (const key of keys) {
    if (!enabled[key]) continue;
    const blurb = CAPABILITY_BLURBS[key];
    lines.push(`- **${key}**: ${blurb.en}`);
    lines.push(`  (HE: ${blurb.he})`);
    lines.push('');
  }
  return lines.join('\n').trim() || getCapabilitiesReferenceStatic();
}
