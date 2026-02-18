import { apiPost } from "./api";

export type ReportContentType =
  | "post"
  | "comment"
  | "direct_message"
  | "group_message"
  | "resale_message";
export type ReportReason = "political" | "hate" | "nudity" | "csam" | "other";

export async function submitReport(
  contentType: ReportContentType,
  contentId: string,
  reason: ReportReason,
  details?: string
): Promise<void> {
  await apiPost("/api/reports", {
    contentType,
    contentId,
    reason,
    ...(details?.trim() ? { details: details.trim() } : {}),
  });
}
