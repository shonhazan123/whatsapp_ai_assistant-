# WhatsApp message templates (Meta Graph API)

Scripts to **create** template definitions on your WhatsApp Business Account and **send** approved templates for manual testing.

References:

- [Managing message templates (Meta)](https://business.whatsapp.com/blog/manage-message-templates-whatsapp-business-api)
- [Cloud API — Message templates](https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-message-templates)

## Prerequisites

- **WABA ID**: WhatsApp Business Account ID (`WHATSAPP_BUSINESS_ACCOUNT_ID`).
- **Token**: System user or app token with **`whatsapp_business_management`** (create templates) and **`whatsapp_business_messaging`** (send messages). Same token as `WHATSAPP_API_TOKEN` if it has both.
- **Phone number ID**: `WHATSAPP_PHONE_NUMBER_ID` (for **send** script only).

Templates must be **approved** by Meta before `send-template-test.ts` can deliver them to a real number.

## Environment

Copy from your Memo_v2 `.env` or set:

| Variable | Used by |
|----------|---------|
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | `create-templates.ts` |
| `WHATSAPP_API_TOKEN` | Both scripts (or override in command line) |
| `WHATSAPP_PHONE_NUMBER_ID` | `send-template-test.ts` |
| `WHATSAPP_TEMPLATE_LANG_HE` | Optional; default `he` |

Runtime template names (also used by `send-template-test.ts` defaults):

| Variable | Purpose |
|----------|---------|
| `WHATSAPP_TEMPLATE_HE_MORNING` | Morning digest (`memo_he_morning_digest`) |
| `WHATSAPP_TEMPLATE_HE_HITL_YN` | Yes / No quick replies (`memo_he_hitl_yes_no`) |
| `WHATSAPP_TEMPLATE_HE_HITL_CONFIRM` | Confirm / Cancel (`memo_he_hitl_confirm_action`) |

## Commands

From **`Memo_v2`** root:

```bash
npx tsx whatsapp-templates-api/create-templates.ts
npx tsx whatsapp-templates-api/send-template-test.ts
```

`send-template-test.ts` sends to **`+972543911602`** by default (override with `WHATSAPP_TEMPLATE_TEST_TO`).

## Template bodies (must match runtime)

Morning digest body in Meta should match what **`ReminderService.sendMorningDigestToWhatsApp`** sends:

- **Body**: `בוקר טוב{{1}}! ☀️` + two newlines + `{{2}}`
  - `{{1}}` = space + first name, or empty (no name).
  - `{{2}}` = digest text from the message-enhancement prompt (Hebrew).

HITL templates need **QUICK_REPLY** buttons:

- `memo_he_hitl_yes_no`: **כן**, **לא**
- `memo_he_hitl_confirm_action`: **אישור**, **ביטול**

Single body variable `{{1}}` = the HITL question text.
