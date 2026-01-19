# Recurring Event Handling

## Overview

When modifying (update/delete) a recurring event, the system must determine whether to operate on the entire series or a single instance. This document describes the detection and HITL flow.

## HITL Trigger Rule

**HITL triggers ONLY when:**
1. LLM resolver did NOT set `recurringSeriesIntent: true`
2. AND entity resolver discovers the event has `recurringEventId`

**NO HITL when:**
- LLM resolver set `recurringSeriesIntent: true` → proceed directly with series operation
- Event is not recurring → proceed normally

## Architecture Flow

```
User Message → CalendarMutateResolver (LLM)
                    ↓
         recurringSeriesIntent: true? ──Yes──→ EntityResolver uses recurringEventId (NO HITL)
                    ↓ No/undefined
         EntityResolution finds event
                    ↓
         Event has recurringEventId? ──No──→ Use eventId normally (NO HITL)
                    ↓ Yes
         HITL: "Do you want all or just this one?"
                    ↓
         User choice → Proceed accordingly
```

## Component Details

### 1. CalendarMutateResolver (LLM Detection)

**File:** `Memo_v2/src/graph/resolvers/CalendarResolvers.ts`

The LLM detects explicit series intent from user message using the `recurringSeriesIntent` field.

| User Message | recurringSeriesIntent |
|--------------|----------------------|
| "תמחק את האירוע החוזר אימון איגרוף" | `true` |
| "delete the recurring event..." | `true` |
| "תעדכן את כל המופעים" | `true` |
| "תמחק את אימון איגרוף ביום שני הקרוב" | `false` or omitted |
| "תמחק את אימון איגרוף" | omitted (ambiguous) |

**Detection Keywords:**
- **Series intent (true):**
  - Hebrew: "האירוע החוזר", "כל המופעים", "את הסדרה"
  - English: "the recurring event", "all occurrences", "the series"
- **Single instance (false/omit):**
  - Specific date references: "ביום שני הקרוב", "מחר", "next Monday"
  - Just event name without "recurring/חוזר"

### 2. CalendarEntityResolver (HITL Trigger)

**File:** `Memo_v2/src/services/resolution/CalendarEntityResolver.ts`

**Key Logic:** Before disambiguation, check if all candidates are from the same recurring series:

```typescript
// In resolveSingleEvent(), BEFORE checking score gap:
const allSameRecurringSeries = this.checkAllSameRecurringSeries(candidates);

if (allSameRecurringSeries) {
  // All candidates are instances of the same recurring event
  // Pick nearest upcoming and handle as recurring (skip disambiguation)
  selectedCandidate = this.pickNearestUpcoming(candidates);
} else {
  // Different events - check score gap for disambiguation
  // ... normal disambiguation logic
}
```

After finding the event, checks for recurring handling in `handleRecurringEventResolution()`:

```typescript
// Case 1: recurringSeriesIntent: true → proceed directly
if (args.recurringSeriesIntent === true) {
  return {
    type: 'resolved',
    args: { eventId: recurringEventId, isRecurringSeries: true },
  };
}

// Case 2: Event is recurring but no series intent → HITL
return {
  type: 'disambiguation',
  question: 'האירוע שאתה מנסה לשנות הוא אירוע חוזר...',
  candidates: [
    { id: 'all', displayText: 'כל המופעים', metadata: { recurringEventId, isRecurringSeries: true } },
    { id: 'single', displayText: 'רק המופע הזה', metadata: { eventId, isRecurringSeries: false } }
  ]
};
```

### 3. HITL Prompt

When triggered, user sees numbered options for clear selection:

**Hebrew:**
```
האירוע שאתה מנסה לשנות הוא אירוע חוזר כל יום שני ב-09:30.
האם תרצה לשנות את כולם או רק את המופע הזה?

1️⃣ כל המופעים
2️⃣ רק המופע הזה (אימון איגרוף, יום ב׳, 26 בינו׳, 09:30)
```

**English:**
```
The event you're trying to modify recurs every Monday at 09:30.
Do you want to modify all occurrences or just this instance?

1️⃣ All occurrences
2️⃣ Just this instance (Boxing Training, Mon, Jan 26, 09:30)
```

**User Response Handling:**
- "1", "כולם", "all", "כל המופעים" → Delete/update entire series
- "2", "רק המופע", "single", "הזה" → Delete/update single instance only

### 4. CalendarService (Execution)

**File:** `src/services/calendar/CalendarService.ts`

New methods added:
- `deleteRecurringSeries(recurringEventId)` - Deletes the master event (cascades to all instances)
- `updateRecurringSeries(recurringEventId, updates)` - Updates the master event (affects all future instances)

### 5. CalendarServiceAdapter (Routing)

**File:** `Memo_v2/src/services/adapters/CalendarServiceAdapter.ts`

Checks `isRecurringSeries` flag in `deleteEvent()` and `updateEvent()`:

```typescript
if (isRecurringSeries) {
  return await calendarService.deleteRecurringSeries(eventId);
}
return await calendarService.deleteEvent(eventId);
```

## Testing Scenarios

### Delete Operations

1. **Series deletion (explicit):** "תמחק את האירוע החוזר אימון איגרוף"
   - LLM: `recurringSeriesIntent: true`
   - Entity: Returns `recurringEventId`
   - Result: Delete master (NO HITL)

2. **Instance deletion (specific date):** "תמחק את אימון איגרוף ביום שני הקרוב"
   - LLM: `recurringSeriesIntent: false` or omitted
   - Entity: Found recurring → HITL prompt
   - User selects "רק המופע הזה"
   - Result: Delete single instance

3. **Ambiguous deletion:** "תמחק את אימון איגרוף" (event is recurring)
   - LLM: No `recurringSeriesIntent`
   - Entity: Found recurring → HITL prompt
   - User chooses
   - Result: Based on user choice

4. **Non-recurring delete:** Regular event delete works as before (no HITL)

### Update Operations

5. **Series update:** "תשנה את השעה של האירוע החוזר ל-10:00"
   - LLM: `recurringSeriesIntent: true`
   - Result: Update master (all instances)

6. **Instance update:** "תזיז את הפגישה של מחר לשעה 14:00" (event is recurring)
   - Entity: Found recurring → HITL prompt
   - User selects option
   - Result: Based on user choice

## Files Modified

| File | Changes |
|------|---------|
| `Memo_v2/src/graph/resolvers/CalendarResolvers.ts` | Added `recurringSeriesIntent` to schema and system prompt |
| `Memo_v2/src/services/resolution/CalendarEntityResolver.ts` | Added `handleRecurringEventResolution()`, updated `applySelection()` |
| `Memo_v2/src/services/resolution/resolution-config.ts` | Added `recurring_choice` message |
| `src/services/calendar/CalendarService.ts` | Added `deleteRecurringSeries()`, `updateRecurringSeries()` |
| `Memo_v2/src/services/adapters/CalendarServiceAdapter.ts` | Added `isRecurringSeries` handling |

## Configuration

### Disambiguation Messages

Located in `Memo_v2/src/services/resolution/resolution-config.ts`:

```typescript
recurring_choice: {
  he: 'האירוע שאתה מנסה לשנות הוא אירוע חוזר כל {recurrence}.\nהאם תרצה לשנות את כולם או רק את המופע הזה?',
  en: 'The event you\'re trying to modify recurs every {recurrence}.\nDo you want to modify all occurrences or just this instance?'
}
```
