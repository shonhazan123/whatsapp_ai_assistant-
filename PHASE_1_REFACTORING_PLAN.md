# Phase 1: DatabaseAgent Simplification & Time-Based Task Offloading

## Executive Summary

This plan outlines the refactoring of the WhatsApp AI Assistant to simplify the DatabaseAgent by removing general task creation responsibilities and restricting it to **reminders** and **lists** only. All time-based task creation will be moved to the CalendarAgent, with updated routing logic in MainAgent to properly detect and route requests based on time expressions and explicit intent.

**Goal**: Prepare the system for Phase 2 (RAG integration) by clearly separating concerns: DatabaseAgent handles reminders/lists, CalendarAgent handles all time-based events/tasks.

---

## 1. DatabaseAgent Simplification

### 1.1 Current State Analysis

**Current Responsibilities:**

- Task creation (with/without time)
- Task updates (all types)
- Task deletion
- Reminder creation (one-time + recurring)
- Reminder updates
- List management
- Contact management
- Category handling
- General "to-do" task logic

**Current Functions Registered:**

- `TaskFunction` (taskOperations) - Full CRUD for tasks
- `ContactFunction` (contactOperations) - Contact management
- `ListFunction` (listOperations) - List management
- `UserDataFunction` (userDataOperations) - User data operations

### 1.2 Target State

**New Responsibilities (ONLY):**

- ✅ Create one-time reminders (with dueDate + reminder interval)
- ✅ Create recurring reminders (reminderRecurrence only, no dueDate)
- ✅ Update reminders (reminderDetails updates)
- ✅ Cancel/delete reminders
- ✅ List creation (shopping lists, checklists, named lists)
- ✅ List deletion
- ✅ List item addition/removal/toggle
- ✅ Contact operations (keep as-is, optional)

**Removed Responsibilities:**

- ❌ General task creation without reminders
- ❌ Task updates (except reminder updates)
- ❌ Task deletion (except reminder cancellations)
- ❌ Category handling for general tasks
- ❌ General "to-do" task logic

### 1.3 System Prompt Changes

**File**: `src/config/system-prompts.ts`  
**Method**: `getDatabaseAgentPrompt()`

**Changes Required:**

1. **Remove Sections:**

   - "TASK CREATION RULES" (lines 171-176) - Remove general task creation
   - "MULTI-TASK AND MULTI-ITEM DETECTION" (lines 231-240) - Remove general task parsing
   - "TASK OPERATIONS" examples that don't involve reminders
   - "CALENDAR OFFER INSTRUCTION" (lines 100-118) - No longer needed since CalendarAgent handles time-based items

2. **Modify Sections:**

   - "ENTITIES YOU MANAGE" (line 120-123):

     - Change from: "**TASKS**: User's tasks with categories, due dates, and completion status"
     - Change to: "**REMINDERS**: One-time reminders (with dueDate) and recurring reminders (standalone)"
     - Keep: "**CONTACTS**" and "**LISTS**" as-is

   - "OPERATIONS BY ENTITY" (lines 137-154):

     - **TASK OPERATIONS**: Restrict to reminder-only operations:
       - Keep: `create` (for reminders only), `update` (for reminder updates only), `delete` (for reminder cancellation)
       - Keep: `getAll` (for querying reminders)
       - Remove: `complete`, `addSubtask` (not applicable to reminders)
       - Clarify: All task operations are now reminder-focused

   - "REMINDER RULES" (lines 178-229):
     - Keep entire section but add clarification:
       - "**CRITICAL**: You ONLY handle reminders. If a user requests a task/event with a time expression but does NOT explicitly say 'remind me', route to CalendarAgent."
       - Add: "You do NOT create general tasks. All task creation through this agent must include reminder parameters."

3. **Add New Section:**

   ```
   ## CRITICAL: REMINDER-ONLY OPERATIONS

   You are a REMINDER and LIST management agent. You do NOT handle general task creation.

   HANDLE YOURSELF IF:
   - User explicitly says "remind me", "תזכיר לי", "remind", "הזכר לי"
   - User wants to create/update/delete lists
   - User wants to manage contacts
   ```

4. **Update Examples:**
   - Remove examples showing general task creation without reminders
   - Keep only reminder-focused examples
   - Update Example 1 (line 316-322): Change to reminder example
   - Remove Example 2 (line 324-332) if it shows general tasks
   - Keep reminder examples (Example 5, 5b, 5c, 5d, 6, 7)

### 1.4 Function Handler Changes

**File**: `src/agents/v2/DatabaseAgent.ts`

**Current Registration (lines 77-93):**

```typescript
private registerFunctions(): void {
  // Task functions
  const taskFunction = new TaskFunction(this.taskService, this.logger);
  this.functionHandler.registerFunction(taskFunction);

  // Contact functions
  const contactFunction = new ContactFunction(this.contactService, this.logger);
  this.functionHandler.registerFunction(contactFunction);

  // List functions
  const listFunction = new ListFunction(this.listService, this.logger);
  this.functionHandler.registerFunction(listFunction);

  // User data functions
  const userDataFunction = new UserDataFunction(this.userDataService, this.logger);
  this.functionHandler.registerFunction(userDataFunction);
}
```

**No Code Changes Required:**

- Keep all function registrations as-is
- The restriction will be enforced through:
  1. System prompt (agent behavior)
  2. Intent routing (MainAgent/Coordinator)
  3. Function parameter validation (if needed in Phase 2)

**Rationale**: The functions themselves remain capable, but the agent's prompt will guide it to only use them for reminders/lists. This allows flexibility while enforcing the separation of concerns.

### 1.5 TaskFunction Parameter Restrictions (Optional)

**File**: `src/agents/functions/DatabaseFunctions.ts`

**Consideration**: Should we restrict `taskOperations` parameters when called by DatabaseAgent?

**Recommendation**: **NO** - Keep function definitions unchanged for now. Reasons:

1. Functions may be called by other agents in the future
2. System prompt + routing logic provides sufficient enforcement
3. Reduces code complexity
4. Allows for future flexibility

**If validation is desired later**, add a check in `TaskFunction.execute()` that validates the operation is reminder-related when called from DatabaseAgent context. This can be added in Phase 2 if needed.

---

## 2. Offloading All Time-Based Tasks to CalendarAgent

### 2.1 Current State Analysis

**CalendarAgent Current Responsibilities:**

- Create calendar events
- Update calendar events
- Delete calendar events
- Get events (list, query)
- Recurring events
- Schedule analysis
- Conflict detection

**CalendarAgent Does NOT Currently Handle:**

- General task creation with time expressions
- Tasks that should be calendar events
- Time-based actions without explicit "calendar" mention

### 2.2 Target State

**New Responsibilities:**

- ✅ Handle ALL time-based task/event creation
- ✅ Automatically create events when timing exists (even without "calendar" keyword)
- ✅ Handle messages like:
  - "I need to call someone tomorrow"
  - "Take the kids at 3"
  - "Meeting next week"
  - "Gym at 17:00"
- ✅ Ask clarifying questions when needed
- ✅ Do NOT create reminders (unless user says "remind me" - then route to DatabaseAgent)

### 2.3 System Prompt Changes

**File**: `src/config/system-prompts.ts`  
**Method**: `getCalendarAgentPrompt()`

**Changes Required:**

1. **Add New Section at Top (after line 676):**

   ```
   ## CRITICAL: TIME-BASED TASK HANDLING

   You are now responsible for ALL time-based task and event creation, even if the user does NOT explicitly mention "calendar" or "יומן".

   HANDLE THESE REQUESTS:
   - "I need to call someone tomorrow" → Create calendar event
   - "Take the kids at 3" → Create calendar event for today at 15:00
   - "Meeting next week" → Create calendar event (ask for specific day/time)
   - "Gym at 17:00" → Create calendar event
   - "תזמן לי פגישה מחר ב-14:00" → Create calendar event
   - Any action with a time expression (tomorrow, at 5, next Monday, etc.)

   DO NOT HANDLE:
   - "Remind me to..." 
   - "תזכיר לי..." 
   - List operations 
   - Contact operations 

   WHEN TO ASK CLARIFYING QUESTIONS:
   - User mentions both calendar and reminder → clarify intent
   ```

2. **Modify "Your Role" Section (lines 696-704):**

   - Add: "7. **Automatically create calendar events for time-based actions** (even without explicit calendar mention)"
   - Add: "8. **Handle all scheduling requests** (meetings, appointments, activities with time)"

3. **Update Examples Section (lines 1034-1054):**

   - Add new examples showing time-based task handling:

     ```
     User: "I need to call John tomorrow at 2pm"
     → Create calendar event: summary="Call John", start="tomorrow 14:00", end="tomorrow 14:30"

     User: "Take the kids to school at 8am"
     → Create calendar event: summary="Take kids to school", start="today 08:00", end="today 08:30"

     User: "Gym session next Monday"
     → Create create calendar event with defoult time 
     ```

### 2.4 Time Expression Detection Rules

**New Rules for Detecting Time Expressions:**

1. **Explicit Time References:**

   - "at [time]" (e.g., "at 5", "at 14:00", "at 2pm")
   - "[time]" (e.g., "5pm", "17:00", "2:30")
   - "tomorrow", "מחר"
   - "today", "היום"
   - "next [day]" (e.g., "next Monday", "יום ראשון הבא")
   - "[day] at [time]" (e.g., "Monday at 3", "יום שני ב-15:00")
   - Date expressions (e.g., "December 25", "25 בדצמבר")

2. **Relative Time References:**

   - "in [duration]" (e.g., "in 2 hours", "בעוד שעתיים")
   - "this [period]" (e.g., "this week", "השבוע")
   - "next [period]" (e.g., "next week", "השבוע הבא")

3. **Time-of-Day References:**
   - "morning", "בוקר"
   - "afternoon", "צהריים"
   - "evening", "ערב"
   - "night", "לילה"

**Implementation Location**: These rules will be used in:

- Intent classifier prompt (Section 3.3)
- CalendarAgent system prompt (Section 2.3)
- MainAgent routing logic (Section 3.2)

---

## 3. MainAgent Routing Logic Update

### 3.1 Current State Analysis

**Current Routing (via Intent Classifier):**

- Uses `OpenAIService.detectIntent()` to classify requests
- Routes based on `primaryIntent` and `involvedAgents`
- Intent classifier prompt (lines 1221-1265) handles routing decisions

**Current Intent Classifier Rules:**

- Treats reminders/tasks with dates as "database" unless user explicitly mentions calendar
- Routes to calendar only when user says "calendar", "יומן", "ביומן", "ליומן"
- Follow-up handling routes based on last agent interaction

### 3.2 New Routing Rules

**File**: `src/config/system-prompts.ts`  
**Method**: `getIntentClassifierPrompt()`

**Changes Required:**

1. **Replace/Update Agent Capabilities Section (lines 1224-1227):**

   ```
   AGENT CAPABILITIES (assume prerequisites like Google connection and plan entitlements must be satisfied):
   - calendar: create/update/cancel single or recurring events; reschedule meetings; manage attendees and RSVPs; add conference links; attach notes; add/update event reminders; list agendas for specific time ranges; answer availability/what's-on-calendar questions; **HANDLE ALL TIME-BASED TASK/EVENT CREATION** (even without explicit "calendar" mention).
   - gmail: draft/send/reply/forward emails; generate follow-ups; search mailbox by sender, subject, labels, time ranges; read email bodies and metadata; archive/delete/label messages; handle attachments (summaries, downloads, uploads via provided methods).
   - database: **ONLY** manage reminders (one-time with dueDate, recurring standalone), lists (shopping lists, checklists, named lists), list items, and contacts; create/update/delete reminder items; mark reminders complete; set reminder due dates and recurrence patterns; look up stored personal information; batch operations across lists; **DO NOT** handle general task creation or time-based events.
   ```

2. **Add New Routing Rules Section (after line 1236):**

   ```
   ROUTING RULES (PHASE 1):

   1. **REMINDER EXPLICIT PHRASING** → database
      - User says "remind me", "תזכיר לי", "remind", "הזכר לי"
      - User wants to set a reminder (one-time or recurring)
      - Route to: database
      - Example: "Remind me tomorrow at 6pm to buy groceries" → database
      - Example: "תזכיר לי כל בוקר ב-8 לקחת ויטמינים" → database

   2. **TIME EXPRESSIONS WITHOUT REMINDER PHRASING** → calendar
      - User mentions time/date but does NOT say "remind me"
      - Examples: "tomorrow", "at 5", "next Monday", "מחר", "ב-14:00", "יום ראשון הבא"
      - Route to: calendar
      - Example: "I need to call someone tomorrow" → calendar
      - Example: "Take the kids at 3" → calendar
      - Example: "Meeting next week" → calendar
      - Example: "Gym at 17:00" → calendar

   3. **LIST OPERATIONS** → database
      - User interacts with lists (create, add item, toggle item, remove item, delete list)
      - Route to: database
      - Example: "Add milk to shopping list" → database
      - Example: "תצור רשימת קניות" → database

   4. **GENERAL TASKS WITHOUT TIME (TEMPORARY FOR PHASE 1)** → database (fallback)
      - General ideas/tasks with NO time expression
      - Route to: database (temporary - Phase 2 will route to RAG)
      - Example: "Buy groceries" (no time) → database
      - Example: "Call mom" (no time) → database
      - Note: This is a temporary fallback until Phase 2 RAG integration

   5. **EXPLICIT CALENDAR MENTION** → calendar
      - User explicitly says "calendar", "יומן", "ביומן", "ליומן", "add to calendar"
      - Route to: calendar
      - Example: "Add meeting to calendar" → calendar
      - Example: "תוסיף ליומן פגישה מחר" → calendar

   6. **FOLLOW-UP CONTEXT** (keep existing logic)
      - If last assistant message was from calendar agent → route to calendar
      - If last assistant message was from database agent → route to database
      - If last assistant message was from gmail agent → route to gmail
   ```

3. **Update Complex Examples Section (lines 1246-1256):**

   - Replace example on line 1256:
     ```
     - User: "תזכיר לי מחר בבוקר ביומן לשלם חשבון" → primaryIntent: "calendar" (time expression + calendar mention)
     ```
   - Add new examples:
     ```
     - User: "I need to call John tomorrow at 2pm" → primaryIntent: "calendar", requiresPlan: false, involvedAgents: ["calendar"]
     - User: "Take the kids at 3" → primaryIntent: "calendar", requiresPlan: false, involvedAgents: ["calendar"]
     - User: "Remind me tomorrow at 6pm to buy groceries" → primaryIntent: "database", requiresPlan: false, involvedAgents: ["database"]
     - User: "Add milk to shopping list" → primaryIntent: "database", requiresPlan: false, involvedAgents: ["database"]
     - User: "Buy groceries" (no time) → primaryIntent: "database", requiresPlan: false, involvedAgents: ["database"] (temporary fallback)
     ```

4. **Update Output Instructions (lines 1258-1265):**
   - Modify line 1264:
     ```
     - Treat reminders/tasks with dates and times as calendar when the user mentions time expressions WITHOUT "remind me" phrasing. Route to database ONLY when user explicitly says "remind me", "תזכיר לי", etc.
     - If user mentions time/date but says "remind me", route to database.
     - If user mentions time/date but does NOT say "remind me", route to calendar.
     ```

### 3.3 MultiAgentCoordinator Changes

**File**: `src/orchestration/MultiAgentCoordinator.ts`

**No Code Changes Required:**

- Coordinator already uses `detectIntent()` from OpenAIService
- Intent classifier prompt changes (Section 3.2) will automatically affect routing
- Coordinator logic (lines 44-87) remains unchanged

**Verification Points:**

- Ensure `resolveInvolvedAgents()` (lines 109-131) correctly handles new routing
- Ensure `executeSingleAgent()` (lines 133-158) works with new agent assignments
- Ensure `planActions()` (lines 89-107) respects new routing rules

---

## 4. Codebase Changes Required

### 4.1 Files Requiring Updates

#### 4.1.1 `src/config/system-prompts.ts`

**Changes:**

1. **`getDatabaseAgentPrompt()`** (lines 88-538):

   - Remove general task creation sections
   - Modify entity descriptions
   - Add reminder-only clarification
   - Update examples
   - Remove calendar offer instruction

2. **`getCalendarAgentPrompt()`** (lines 675-1060):

   - Add time-based task handling section
   - Update role description
   - Add new examples for time-based tasks

3. **`getIntentClassifierPrompt()`** (lines 1221-1265):

   - Update agent capabilities
   - Add new routing rules section
   - Update examples
   - Modify output instructions

4. **`getMainAgentPrompt()`** (lines 12-82):
   - **Optional**: Update tool selection rules to reflect new routing
   - **Recommended**: Keep as-is for now (routing handled by intent classifier)

#### 4.1.2 `src/agents/v2/DatabaseAgent.ts`

**Changes:**

- **None required** - Function registrations remain unchanged
- System prompt changes will guide agent behavior

#### 4.1.3 `src/agents/v2/CalendarAgent.ts`

**Changes:**

- **None required** - System prompt changes will guide agent behavior

#### 4.1.4 `src/agents/v2/MainAgent.ts`

**Changes:**

- **None required** - Routing handled by MultiAgentCoordinator via intent classifier

#### 4.1.5 `src/orchestration/MultiAgentCoordinator.ts`

**Changes:**

- **None required** - Uses intent classifier which will be updated

#### 4.1.6 `src/core/base/FunctionHandler.ts`

**Changes:**

- **None required** - Function handler remains generic

#### 4.1.7 `src/agents/functions/DatabaseFunctions.ts`

**Changes:**

- **None required** - Function definitions remain unchanged
- Optional: Add validation in Phase 2 if needed

### 4.2 Summary of Changes

| File                                         | Changes Required           | Priority |
| -------------------------------------------- | -------------------------- | -------- |
| `src/config/system-prompts.ts`               | Major updates to 3 methods | **HIGH** |
| `src/agents/v2/DatabaseAgent.ts`             | None                       | N/A      |
| `src/agents/v2/CalendarAgent.ts`             | None                       | N/A      |
| `src/agents/v2/MainAgent.ts`                 | None                       | N/A      |
| `src/orchestration/MultiAgentCoordinator.ts` | None                       | N/A      |
| `src/core/base/FunctionHandler.ts`           | None                       | N/A      |
| `src/agents/functions/DatabaseFunctions.ts`  | None                       | N/A      |

**Total Files to Modify**: **1 file** (`system-prompts.ts`)

---

## 5. DB Schema Adjustments (Optional for Phase 1)

### 5.1 Current Schema

**Tasks Table** (from `scripts/COMPLETE-DATABASE-SETUP.sql`):

```sql
CREATE TABLE IF NOT EXISTS tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    category VARCHAR(50),
    due_date TIMESTAMP WITH TIME ZONE,
    reminder INTERVAL,
    reminder_recurrence JSONB,
    next_reminder_at TIMESTAMP WITH TIME ZONE,
    completed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### 5.2 Recommendations

**Option 1: Keep Schema Unchanged (RECOMMENDED)**

- **Rationale**:
  - Tasks table already supports reminders (reminder, reminder_recurrence fields)
  - No need to create separate "reminders" table
  - Existing tasks can remain in DB (backwards compatibility)
  - Phase 2 RAG may need task table for other purposes


### 5.3 Final Recommendation

**Keep tasks table unchanged for Phase 1.**

**Reasoning:**

1. Schema already supports reminders (reminder, reminder_recurrence fields)
2. No migration needed
3. Backwards compatible with existing data
4. Phase 2 RAG integration may use tasks table differently
5. Separation of concerns is achieved through agent behavior, not schema

**Future Consideration (Phase 2+):**

- If RAG agent needs to store general tasks/notes, consider:
  - Adding `task_type` column
  - Or creating separate `notes`/`knowledge` table for RAG
  - But this is out of scope for Phase 1

---

## 6. Backwards Compatibility

### 6.1 Existing Reminders in Database

**Current State:**

- Existing tasks with `reminder` or `reminder_recurrence` fields are already in DB
- These are valid reminders and should continue working

**Handling:**

- ✅ **No changes needed** - DatabaseAgent will continue to handle these via `taskOperations.getAll()` with reminder filters
- ✅ Existing reminder queries will work as-is
- ✅ Reminder updates will work via `taskOperations.update()` with `reminderDetails`

**Verification:**

- Test that existing reminders are still queryable
- Test that existing reminders can be updated
- Test that existing reminders can be deleted

### 6.2 Old Tasks Created Without Time

**Current State:**

- Tasks in DB with no `due_date`, no `reminder`, no `reminder_recurrence`
- These are "general tasks" that don't fit new DatabaseAgent scope

**Handling Strategy:**

**Option A: Leave as Legacy (RECOMMENDED)**

- Keep existing tasks in DB
- DatabaseAgent can still query them via `getAll()` (for user reference)
- DatabaseAgent will NOT create new tasks of this type
- User can manually delete/complete old tasks
- **No migration needed**

**Option B: Mark as Legacy**

- Add `task_type = 'legacy'` flag (requires schema change - not recommended for Phase 1)
- Filter out legacy tasks from reminder queries
- **Not recommended** - Adds complexity

**Option C: Migrate to CalendarAgent**

- Attempt to convert old tasks to calendar events
- **Not recommended** - Risky, may create duplicates, user may not want this

**Final Recommendation: Option A**

- Leave old tasks as-is
- They remain queryable but won't be created by DatabaseAgent anymore
- User can manage them manually if needed
- Phase 2 RAG may handle general tasks differently

### 6.3 Potential Conflicts Between CalendarAgent and DatabaseAgent

**Scenario 1: User says "Remind me tomorrow at 6pm"**

- **Routing**: DatabaseAgent (explicit "remind me")
- **Action**: Create reminder task with dueDate + reminder interval
- **Conflict**: None - Clear routing rule

**Scenario 2: User says "Meeting tomorrow at 6pm"**

- **Routing**: CalendarAgent (time expression, no "remind me")
- **Action**: Create calendar event
- **Conflict**: None - Clear routing rule

**Scenario 3: User says "תזכיר לי מחר ב-14:00 ליומן פגישה"**

- **Routing**: DatabaseAgent (explicit "תזכיר לי")
- **Action**: Create reminder
- **Note**: User mentioned "יומן" but also said "תזכיר לי" - reminder takes precedence
- **Conflict**: None - Explicit reminder phrasing wins

**Scenario 4: User says "תוסיף ליומן פגישה מחר ב-14:00 ותזכיר לי יום לפני"**

- **Routing**: Multi-agent (calendar + database)
- **Action**:
  1. CalendarAgent creates event
  2. DatabaseAgent creates reminder for day before
- **Conflict**: None - Coordinated multi-agent action

**Prevention Strategy:**

1. Clear routing rules in intent classifier (Section 3.2)
2. Explicit reminder phrasing always routes to DatabaseAgent
3. Time expressions without reminder phrasing route to CalendarAgent
4. Multi-agent coordination handles combined requests

### 6.4 Testing Backwards Compatibility

**Test Cases:**

1. **Query Existing Reminders:**

   - User: "What reminders do I have?"
   - Expected: DatabaseAgent returns existing reminders from DB
   - Verify: Old reminders still appear

2. **Update Existing Reminder:**

   - User: "תעדכן את התזכורת שלי ל[existing reminder] למחר ב-10"
   - Expected: DatabaseAgent updates reminder via `taskOperations.update()`
   - Verify: Update succeeds

3. **Query Old General Tasks:**

   - User: "Show all my tasks"
   - Expected: DatabaseAgent may return old tasks (if they have reminder fields) or may filter them out
   - Verify: Behavior is consistent

4. **Create New Reminder:**

   - User: "Remind me tomorrow at 6pm to buy groceries"
   - Expected: DatabaseAgent creates reminder
   - Verify: New reminder created with correct fields

5. **Create Time-Based Event:**
   - User: "I need to call John tomorrow at 2pm"
   - Expected: CalendarAgent creates event
   - Verify: Event created in calendar, NOT in tasks table

---

## 7. Implementation Checklist

### 7.1 Pre-Implementation

- [ ] Review this plan with team
- [ ] Backup current system prompts
- [ ] Create feature branch: `phase-1-database-simplification`
- [ ] Set up test environment

### 7.2 Implementation Steps

#### Step 1: Update DatabaseAgent System Prompt

- [ ] Remove general task creation sections
- [ ] Modify entity descriptions
- [ ] Add reminder-only clarification section
- [ ] Update examples (remove non-reminder examples)
- [ ] Remove calendar offer instruction
- [ ] Test: Verify prompt is syntactically correct

#### Step 2: Update CalendarAgent System Prompt

- [ ] Add time-based task handling section
- [ ] Update role description
- [ ] Add new examples for time-based tasks
- [ ] Test: Verify prompt is syntactically correct

#### Step 3: Update Intent Classifier Prompt

- [ ] Update agent capabilities section
- [ ] Add new routing rules section
- [ ] Update examples
- [ ] Modify output instructions
- [ ] Test: Verify prompt is syntactically correct

#### Step 4: Testing

- [ ] Test reminder creation: "Remind me tomorrow at 6pm"
- [ ] Test time-based event: "I need to call John tomorrow at 2pm"
- [ ] Test list operations: "Add milk to shopping list"
- [ ] Test general task (fallback): "Buy groceries" (no time)
- [ ] Test existing reminders: Query and update
- [ ] Test multi-agent: "תוסיף ליומן פגישה מחר ותזכיר לי יום לפני"
- [ ] Test edge cases: Vague time expressions, ambiguous requests

#### Step 5: Documentation

- [ ] Update agent responsibility documentation
- [ ] Document new routing rules
- [ ] Update API/function documentation if needed

### 7.3 Post-Implementation

- [ ] Monitor logs for routing accuracy
- [ ] Collect user feedback
- [ ] Fix any routing issues
- [ ] Prepare for Phase 2 (RAG integration)

---

## 8. Risk Assessment & Mitigation

### 8.1 Risks

**Risk 1: Intent Misclassification**

- **Impact**: Requests routed to wrong agent
- **Mitigation**:
  - Clear routing rules in intent classifier
  - Extensive testing of edge cases
  - Monitor logs and adjust prompts if needed

**Risk 2: User Confusion**

- **Impact**: Users don't understand new behavior
- **Mitigation**:
  - Clear agent responses explaining actions
  - User education if needed
  - Graceful fallback handling

**Risk 3: Backwards Compatibility Issues**

- **Impact**: Existing reminders/tasks break
- **Mitigation**:
  - Thorough testing of existing data
  - No schema changes
  - Keep function definitions unchanged

**Risk 4: CalendarAgent Overload**

- **Impact**: Too many requests routed to CalendarAgent
- **Mitigation**:
  - Monitor routing patterns
  - Adjust rules if needed
  - Ensure CalendarAgent can handle load

### 8.2 Rollback Plan

If issues arise:

1. Revert system prompt changes
2. Restore previous intent classifier rules
3. Monitor and fix issues
4. Re-implement with adjustments

---

## 9. Success Criteria

### 9.1 Functional Requirements

- ✅ DatabaseAgent only handles reminders and lists
- ✅ CalendarAgent handles all time-based task/event creation
- ✅ Routing correctly identifies reminder vs. time-based requests
- ✅ Existing reminders continue to work
- ✅ List operations work as before
- ✅ Contact operations work as before

### 9.2 Non-Functional Requirements

- ✅ No breaking changes to existing functionality
- ✅ No database schema changes
- ✅ No function signature changes
- ✅ Backwards compatible with existing data
- ✅ Clear separation of concerns

### 9.3 Metrics

- Routing accuracy: >95% correct agent selection
- User satisfaction: No increase in confusion/complaints
- System stability: No increase in errors

---

## 10. Future Considerations (Phase 2+)

### 10.1 RAG Agent Integration

**Phase 2 will:**

- Route general tasks (no time, no reminder) to RAG agent
- RAG agent will handle knowledge-based tasks, notes, general ideas
- DatabaseAgent remains reminder/list focused
- CalendarAgent remains time-based event focused

**No changes needed in Phase 1** - Current fallback to DatabaseAgent for general tasks is temporary.

### 10.2 Potential Enhancements

**Future considerations (not in Phase 1):**

- Add `task_type` column to tasks table (if needed)
- Create dedicated reminders table (if needed)
- Add validation in TaskFunction for reminder-only operations (if needed)
- Enhanced time expression parsing (if needed)

---

## 11. Conclusion

This plan provides a clear path to simplify DatabaseAgent and offload time-based tasks to CalendarAgent. The changes are minimal (primarily system prompt updates) and maintain backwards compatibility. The system will be ready for Phase 2 RAG integration with clear separation of concerns.

**Key Takeaways:**

1. **Minimal code changes** - Only system prompts need updating
2. **Backwards compatible** - No schema or function changes
3. **Clear routing rules** - Intent classifier handles new logic
4. **Ready for Phase 2** - Foundation set for RAG integration

**Next Steps:**

1. Review and approve this plan
2. Implement changes following the checklist
3. Test thoroughly
4. Deploy and monitor
5. Begin Phase 2 planning

---

**Document Version**: 1.0  
**Last Updated**: 2025-01-27  
**Status**: Ready for Implementation
