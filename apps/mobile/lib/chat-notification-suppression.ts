/**
 * While a conversation screen is focused, matching chat push notifications are suppressed
 * in the foreground (see notifications.ts setNotificationHandler).
 */
let openChatConversationId: string | null = null;

export function setOpenChatConversationId(conversationId: string | null): void {
  openChatConversationId = conversationId?.trim() || null;
}

export function getOpenChatConversationId(): string | null {
  return openChatConversationId;
}
