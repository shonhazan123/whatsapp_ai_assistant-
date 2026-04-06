/**
 * Send approved template messages to a test number (default +972543911602).
 *
 * Requires templates to exist and be APPROVED in Meta.
 *
 * Run from Memo_v2: npx tsx whatsapp-templates-api/send-template-test.ts
 */

import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION || "v22.0";
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const TOKEN = process.env.WHATSAPP_API_TOKEN;
const LANG = process.env.WHATSAPP_TEMPLATE_LANG_HE || "he";

const TEMPLATE_MORNING =
	process.env.WHATSAPP_TEMPLATE_HE_MORNING || "memo_he_morning_digest";
const TEMPLATE_YN =
	process.env.WHATSAPP_TEMPLATE_HE_HITL_YN || "memo_he_hitl_yes_no";
const TEMPLATE_CONFIRM =
	process.env.WHATSAPP_TEMPLATE_HE_HITL_CONFIRM ||
	"memo_he_hitl_confirm_action";

/** E.164 without + for Cloud API */
const DEFAULT_TEST_TO = "972543911602";
const TEST_TO = (
	process.env.WHATSAPP_TEMPLATE_TEST_TO || DEFAULT_TEST_TO
).replace(/^\+/, "");

const BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

/** Sample copy aligned with getMessageEnhancementPrompt Type B + HITLGateNode tone */
const SAMPLE_DIGEST_BODY = `זה מה שמחכה לך היום, 5 באפריל 2026:

📅 *ביומן היום:*

אין אירועים מתוזמנים היום.

יום מוצלח ובהצלחה! 💪`;

const SAMPLE_HITL_YN =
	"רק מוודאה — למחוק את *משימת בדיקה*? 🙂";

const SAMPLE_HITL_CONFIRM =
	"רגע לפני שממשיכה — פעולה זו עשויה למחוק פריטים לצמיתות. לאשר?";

function assertSubstrings(label: string, full: string, subs: string[]) {
	for (const s of subs) {
		if (!full.includes(s)) {
			throw new Error(`[${label}] expected wording missing fragment: ${s}`);
		}
	}
	console.log(`[OK wording] ${label}`);
}

async function sendTemplate(
	name: string,
	bodyParams: string[],
): Promise<void> {
	if (!PHONE_NUMBER_ID || !TOKEN) {
		throw new Error("WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_API_TOKEN required");
	}
	const url = `${BASE}/${PHONE_NUMBER_ID}/messages`;
	console.log(`\n→ Sending template "${name}" to +${TEST_TO}`);
	const payload = {
		messaging_product: "whatsapp",
		to: TEST_TO,
		type: "template",
		template: {
			name,
			language: { code: LANG },
			components: [
				{
					type: "body",
					parameters: bodyParams.map((text) => ({ type: "text", text })),
				},
			],
		},
	};
	console.log("Parameters:", JSON.stringify(bodyParams, null, 2));
	const { data } = await axios.post(url, payload, {
		headers: {
			Authorization: `Bearer ${TOKEN}`,
			"Content-Type": "application/json",
		},
	});
	console.log("Response:", JSON.stringify(data, null, 2));
}

async function main() {
	assertSubstrings("morning digest body", SAMPLE_DIGEST_BODY, [
		"📅 *ביומן היום:*",
		"יום מוצלח",
	]);
	assertSubstrings("HITL yn", SAMPLE_HITL_YN, ["רק מוודאה", "למחוק"]);
	assertSubstrings("HITL confirm", SAMPLE_HITL_CONFIRM, ["לפני", "לאשר"]);

	const nameSlot = " בודק";
	const morningDisplay = `בוקר טוב${nameSlot}! ☀️\n\n${SAMPLE_DIGEST_BODY}`;
	assertSubstrings("morning display", morningDisplay, ["בוקר טוב", "☀️"]);

	console.log("\n--- Sending 3 templates (requires APPROVED status in Meta) ---\n");

	await sendTemplate(TEMPLATE_MORNING, [nameSlot, SAMPLE_DIGEST_BODY]);
	await sendTemplate(TEMPLATE_YN, [SAMPLE_HITL_YN]);
	await sendTemplate(TEMPLATE_CONFIRM, [SAMPLE_HITL_CONFIRM]);

	console.log("\nDone.");
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
