/** Last message line for inbox rows (text or shared-content label). */
export function inboxPreviewFromLastMessage(
  m:
    | {
        content?: string | null;
        sharedContentType?: string | null;
      }
    | undefined,
  emptyLabel: string
): string {
  if (!m) return emptyLabel;
  const text = (m.content ?? "").trim();
  if (text.length > 0) return text;
  switch (m.sharedContentType) {
    case "photo":
      return "Photo";
    case "event":
      return "Shared an event";
    case "business":
      return "Shared a business";
    case "store_item":
      return "Shared an item";
    case "coupon":
      return "Shared a coupon";
    case "reward":
      return "Shared a reward";
    case "blog":
      return "Shared a post";
    case "post":
      return "Shared a post";
    default:
      return "Message";
  }
}

export function inboxPreviewSubtitle(args: {
  previewBase: string;
  unreadFromOthers: number;
  isTyping: boolean;
  emptyLabel: string;
}): { text: string; bold: boolean } {
  if (args.isTyping) {
    return { text: "Typing…", bold: true };
  }
  const n = args.unreadFromOthers;
  if (n > 1) {
    return { text: `${n} New Messages`, bold: true };
  }
  if (n === 1) {
    return { text: args.previewBase || args.emptyLabel, bold: true };
  }
  return { text: args.previewBase || args.emptyLabel, bold: false };
}
