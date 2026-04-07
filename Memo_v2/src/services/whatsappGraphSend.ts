/**
 * Deliver Memo graph results to WhatsApp.
 *
 * **Default (almost all traffic):** `sendWhatsAppMessage` — session **plain text**, same as pre-template behavior.
 *
 * **Template is exceptional and narrow:**
 * - Only when the graph **paused for HITL** with `expectedInput === 'yes_no'` (approval / risky confirm),
 *   **and** `WHATSAPP_TEMPLATE_HE_HITL_CONFIRM` / `WHATSAPP_TEMPLATE_HE_HITL_YN` are set in env.
 * - Morning digest templates are **not** handled here — see `ReminderService.sendMorningDigestToWhatsApp`.
 *
 * If template env vars are unset, or the interrupt is clarification/disambiguation/free text, this always sends plain text.
 */

import type { InvokeResult } from "../graph/index.js";
import type { HITLReason } from "../types/hitl.js";
import {
	sendWhatsAppMessage,
	sendWhatsAppTemplateMessage,
} from "./whatsapp.js";

function getHeTemplateLang(): string {
	return process.env.WHATSAPP_TEMPLATE_LANG_HE || "he";
}

function pickHitlTemplateName(reason: HITLReason | undefined): string | undefined {
	const confirmTpl = process.env.WHATSAPP_TEMPLATE_HE_HITL_CONFIRM?.trim();
	const ynTpl = process.env.WHATSAPP_TEMPLATE_HE_HITL_YN?.trim();
	if (reason === "high_risk") {
		return confirmTpl || ynTpl;
	}
	if (reason === "needs_approval") {
		return ynTpl || confirmTpl;
	}
	return ynTpl || confirmTpl;
}

/**
 * Send the graph result to the user on WhatsApp.
 * Plain text by default; template only for the narrow HITL yes/no case above when env is configured.
 */
export async function deliverMemoGraphInvokeResult(
	userPhone: string,
	result: InvokeResult,
): Promise<void> {
	const meta = result.interruptPayload?.metadata;
	const question = result.interruptPayload?.question?.trim();

	const isHitlYesNo =
		result.interrupted &&
		meta?.expectedInput === "yes_no" &&
		Boolean(question);

	if (isHitlYesNo) {
		const templateName = pickHitlTemplateName(meta?.reason);
		if (templateName) {
			await sendWhatsAppTemplateMessage(
				userPhone,
				templateName,
				getHeTemplateLang(),
				[question!],
				{ persistToMemory: false },
			);
			return;
		}
	}

	// Normal replies, non-yes-no HITL, or yes/no HITL without template env: session text only.
	await sendWhatsAppMessage(userPhone, result.response);
}
