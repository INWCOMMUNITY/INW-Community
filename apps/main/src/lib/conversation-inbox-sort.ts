/** Sort threads by latest message time (not conversation.updatedAt, which can bump on read). */
export function sortConversationsByLastMessageDesc<
  T extends { messages: { createdAt: Date | string }[]; updatedAt: Date | string }
>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const ta = new Date(a.messages?.[0]?.createdAt ?? a.updatedAt).getTime();
    const tb = new Date(b.messages?.[0]?.createdAt ?? b.updatedAt).getTime();
    return tb - ta;
  });
}
