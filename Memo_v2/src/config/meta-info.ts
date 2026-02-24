/**
 * Canonical agent identity and links — single source of truth for GeneralResolver (general capability).
 * Loaded once at module import; no DB, no LLM.
 *
 * Agent: Donna (EN) / דונה (HE) — female persona.
 */

export interface MetaInfo {
  agentName: string;
  agentNameHebrew: string;
  shortDescription: string;
  shortDescriptionHebrew: string;
  websiteUrl: string;
  supportUrl?: string;
  privacyUrl?: string;
  helpLinks: { label: string; url: string }[];
}

export const META_INFO: MetaInfo = {
  agentName: 'Donna',
  agentNameHebrew: 'דונה',
  shortDescription:
    'Donna turns WhatsApp into your second brain — so you can think less and do more. A personal AI secretary for your calendar, tasks, memory, and more.',
  shortDescriptionHebrew:
    'דונה הופכת את WhatsApp למוח השני שלך — כך שתוכלי לחשוב פחות ולעשות יותר. מזכירה אישית חכמה ליומן, משימות, זיכרון ועוד.',
  websiteUrl:  'https://donnai.io',
  supportUrl: "donnai.help@gmail.com",
  privacyUrl: "https://donnai.io/privacy",
  helpLinks: [
    { label: 'Pricing & plans', url: 'https://donnai.io/pricing' },
    { label: 'מחירון ותוכניות', url: 'https://donnai.io/pricing' },
    { label: 'Get started', url: 'https://donnai.io/login' },
  ],
};

export function getMetaInfo(): MetaInfo {
  return META_INFO;
}
