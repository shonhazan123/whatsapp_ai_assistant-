/**
 * POST /{WABA_ID}/message_templates — create Hebrew UTILITY templates for Memo.
 *
 * Requires: WHATSAPP_BUSINESS_ACCOUNT_ID, WHATSAPP_API_TOKEN (whatsapp_business_management)
 *
 * Run: npx tsx whatsapp-templates-api/create-templates.ts
 */

import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION || "v22.0";
const WABA_ID = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
const TOKEN = process.env.WHATSAPP_API_TOKEN;

const BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

/** Bodies must stay aligned with ReminderService + whatsappGraphSend + send-template-test. */
const TEMPLATES: Array<Record<string, unknown>> = [
	{
		name: "memo_he_morning_digest",
		language: "he",
		category: "UTILITY",
		components: [
			{
				type: "BODY",
				text: "בוקר טוב{{1}}! ☀️\n\n{{2}}",
			},
		],
	},
	{
		name: "memo_he_hitl_yes_no",
		language: "he",
		category: "UTILITY",
		components: [
			{
				type: "BODY",
				text: "{{1}}",
			},
			{
				type: "BUTTONS",
				buttons: [
					{ type: "QUICK_REPLY", text: "כן" },
					{ type: "QUICK_REPLY", text: "לא" },
				],
			},
		],
	},
	{
		name: "memo_he_hitl_confirm_action",
		language: "he",
		category: "UTILITY",
		components: [
			{
				type: "BODY",
				text: "{{1}}",
			},
			{
				type: "BUTTONS",
				buttons: [
					{ type: "QUICK_REPLY", text: "אישור" },
					{ type: "QUICK_REPLY", text: "ביטול" },
				],
			},
		],
	},
];

async function main() {
	if (!WABA_ID || !TOKEN) {
		console.error(
			"Set WHATSAPP_BUSINESS_ACCOUNT_ID and WHATSAPP_API_TOKEN in Memo_v2/.env",
		);
		process.exit(1);
	}

	for (const body of TEMPLATES) {
		const name = body.name as string;
		try {
			const url = `${BASE}/${WABA_ID}/message_templates`;
			const { data } = await axios.post(url, body, {
				headers: {
					Authorization: `Bearer ${TOKEN}`,
					"Content-Type": "application/json",
				},
			});
			console.log(`OK ${name}:`, JSON.stringify(data, null, 2));
		} catch (e: unknown) {
			const err = e as { response?: { data?: unknown; status?: number } };
			console.error(
				`FAIL ${name}:`,
				err.response?.status,
				JSON.stringify(err.response?.data, null, 2),
			);
		}
	}
}

main();
