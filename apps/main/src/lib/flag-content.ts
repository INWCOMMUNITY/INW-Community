/**
 * Helper to create FlaggedContent records when moderation triggers.
 * Used across posts, events, businesses, store items, messages.
 */
import { prisma } from "database";

export type FlaggedContentType =
  | "post"
  | "message"
  | "business"
  | "event"
  | "store_item";

export type FlaggedReason = "slur" | "prohibited_category" | "profanity" | "restricted";

export async function createFlaggedContent(params: {
  contentType: FlaggedContentType;
  contentId?: string | null;
  reason: FlaggedReason;
  snippet?: string | null;
  authorId?: string | null;
}): Promise<void> {
  try {
    await prisma.flaggedContent.create({
      data: {
        contentType: params.contentType,
        contentId: params.contentId ?? null,
        reason: params.reason,
        snippet: params.snippet ?? null,
        authorId: params.authorId ?? null,
        status: "pending",
      },
    });
  } catch (e) {
    console.error("[flag-content] Failed to create FlaggedContent:", e);
  }
}
