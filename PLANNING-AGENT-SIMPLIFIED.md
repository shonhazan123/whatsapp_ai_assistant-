# Planning Agent - Simplified Architecture

## 🎯 Overview

Planning Agent פשוט וקל לשימוש שמתכנן לפי **מה שפנוי ביומן** של המשתמש.

## 💡 עקרונות תכנון:

1. ✅ **עובד לפי יומן** - הסוכן מתכנן רק לפי מה שפנוי
2. ✅ **יוצר בלוקים קבועים** - המשתמש יכול ליצור בלוקים קבועים (עבודה, לימודים, אימון)
3. ✅ **זיהוי חכם** - הסוכן מזהה מה המשתמש רוצה לפי השם שנתן או לפי ההקשר
4. ✅ **טיפול בקונפליקטים** - שואל את המשתמש ומציע חלופות
5. ✅ **ללא למידה** - הסוכן לא לומד, רק מתכנן לפי הזמינות

## 📋 דוגמאות שימוש:

### 1. יצירת בלוקים קבועים

```
User: "תסגור לי ביומן את השעות 9 עד 18:00 בימים ראשון שלישי ורביעי כי אלו הימים והשעות שאני עובד"

Agent:
1. מזהה: "עבודה" (לפי ההקשר)
2. יוצר 3 אירועים קבועים:
   - יום א' 9:00-18:00 "עבודה"
   - יום ג' 9:00-18:00 "עבודה"
   - יום ד' 9:00-18:00 "עבודה"
3. ✅ "יצרתי 3 אירועים קבועים לעבודה"
```

### 2. יצירת בלוקים עם שם מותאם אישית

```
User: "תסגור לי את השעות 19-21 בימים א', ב', ג', ד', ה' ללימודים"

Agent:
1. מזהה: "לימודים" (לפי ההקשר)
2. יוצר 5 אירועים קבועים:
   - יום א' 19:00-21:00 "לימודים"
   - יום ב' 19:00-21:00 "לימודים"
   - יום ג' 19:00-21:00 "לימודים"
   - יום ד' 19:00-21:00 "לימודים"
   - יום ה' 19:00-21:00 "לימודים"
3. ✅ "יצרתי 5 אירועים קבועים ללימודים"
```

### 3. תכנון לפי זמינות

```
User: "תכנן לי לימודים למבחן במתמטיקה"

Agent:
1. בודק ביומן מה פנוי
2. רואה שיש בלוקים של "עבודה" ו"לימודים"
3. מתכנן לימודים נוספים רק בשעות/ימים פנויים
4. ✅ "תוכנית לימודים מותאמת לזמינות שלך"
```

### 4. טיפול בקונפליקטים

```
User: "תסגור לי את השעות 10-12 ביום א' לפגישה"

Agent:
1. בודק ביומן
2. רואה שיש "עבודה" 9-18 ביום א'
3. ⚠️ "יש קונפליקט עם 'עבודה' ביום א' 10-12
   אפשרויות:
   - להזיז את הפגישה לשעה אחרת
   - לבטל את 'עבודה' בשעות האלה
   - להשאיר את הקונפליקט"
```

### 5. תכנון שבוע

```
User: "תכנן לי את השבוע הבא"

Agent:
1. בודק ביומן מה יש
2. רואה בלוקים קבועים: "עבודה", "לימודים"
3. שואל: "מה המטרות שלך השבוע?"
4. מתכנן לפי הזמינות והמטרות
5. ✅ "השבוע מתוכנן!"
```

## 🏗️ Architecture Components

### 1. **Context Management** (`src/context/`)
- `PlanningContext.ts` - ניהול הקשר של תהליך תכנון
- `PlanningContextManager.ts` - ניהול contexts

### 2. **Orchestration Layer** (`src/orchestration/`)
- `StateMachine.ts` - ניהול מצבי תהליך
- `WorkflowEngine.ts` - מנוע workflows
- `MultiAgentCoordinator.ts` - תאום סוכנים
- `HumanInTheLoop.ts` - ניהול אישורים

### 3. **Strategy Layer** (`src/strategies/`)
- `BaseStrategy.ts` - אבסטרקציה לאסטרטגיות
- `StudyStrategy.ts` - אסטרטגיית תכנון לימודים

### 4. **Workflow Layer** (`src/workflows/`)
- `BaseWorkflow.ts` - אבסטרקציה ל-workflows
- `StudyPlanningWorkflow.ts` - Workflow לתכנון לימודים

### 5. **Agent Layer** (`src/agents/v2/`)
- `PlanningAgent.ts` - הסוכן הראשי לתכנון

## 🔄 Flow Diagram

```
User Message
    ↓
PlanningAgent
    ↓
Detect Goal & Collect Data
    ↓
Select Strategy (Study/Meeting/Week)
    ↓
┌─────────────────────────────────────┐
│ Workflow Execution                  │
│                                     │
│ 1. Discovery                        │
│    - Ask questions if needed        │
│    - Collect required data          │
│                                     │
│ 2. Analysis                         │
│    - Analyze goal & constraints     │
│    - Check calendar availability    │
│                                     │
│ 3. Planning                         │
│    - Generate plan using strategy   │
│    - Check for conflicts            │
│                                     │
│ 4. Validation                       │
│    - Present plan to user           │
│    - Wait for approval              │
│                                     │
│ 5. Execution                        │
│    - Coordinate agents              │
│    - Create tasks/events            │
│    - Send progress updates          │
│                                     │
│ 6. Completed                        │
│    - Send summary                   │
└─────────────────────────────────────┘
    ↓
Return Result to User
```

## 🎯 Key Features

### 1. **Calendar-Based Planning**
- הסוכן מתכנן רק לפי מה שפנוי ביומן
- לא צריך העדפות מורכבות
- פשוט ויעיל

### 2. **Recurring Blocks**
- יצירת בלוקים קבועים (עבודה, לימודים, אימון)
- זיהוי חכם של סוג הפעילות
- תכנון לפי הבלוקים

### 3. **Conflict Resolution**
- זיהוי קונפליקטים אוטומטי
- הצעת חלופות
- אישור המשתמש

### 4. **Smart Detection**
- זיהוי סוג פעילות לפי שם
- זיהוי לפי הקשר
- זיהוי לפי דפוסים

### 5. **No Learning**
- הסוכן לא לומד
- פשוט וברור
- לא מסתמך על נתונים ישנים

## 📊 מה נמחק:

- ❌ `UserPreferences.ts` - לא צריך העדפות מורכבות
- ❌ `create-user-preferences-table.sql` - לא צריך טבלה
- ❌ Learning System - הסוכן לא לומד
- ❌ Complex Preferences - פשוט לפי יומן

## 🚀 מה נשאר:

- ✅ PlanningAgent - פשוט וממוקד
- ✅ Workflow Engine - תהליכי תכנון
- ✅ State Machine - ניהול מצבים
- ✅ Multi-Agent Coordinator - תאום סוכנים
- ✅ Strategy Pattern - אסטרטגיות
- ✅ Calendar Integration - עבודה לפי יומן

## 💡 Tips

1. **היה ספציפי** - תן שם ברור לבלוקים
2. **בדוק קונפליקטים** - הסוכן יזהה וישאל
3. **סמוך על הסוכן** - הוא מתכנן לפי הזמינות
4. **תן משוב** - אם משהו לא בסדר, תגיד

## 🔗 Related Documentation

- [ARCHITECTURE-V2.md](./ARCHITECTURE-V2.md) - V2 Architecture overview
- [AI-INTENT-DETECTION.md](./docs/AI-INTENT-DETECTION.md) - Intent detection guide

---

**Simple, Clean, Effective! 🎯**
