/**
 * WhatsApp service - re-export from Memo V2
 *
 * All sends use Memo_v2's sendWhatsAppMessage, which stores the assistant message
 * in Memo_v2 ConversationWindow with the returned message ID for reply context.
 */
export {
  downloadWhatsAppMedia, markMessageAsRead, sendTypingIndicator, sendWhatsAppMessage
} from "../../Memo_v2/dist/index";

