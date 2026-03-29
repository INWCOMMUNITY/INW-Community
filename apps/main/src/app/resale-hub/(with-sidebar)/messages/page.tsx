import { redirect } from "next/navigation";

type Props = { searchParams?: Record<string, string | string[] | undefined> };

/**
 * Resale hub messages now live on the unified My Community inbox (live Socket.IO, typing, presence).
 * Preserves ?conversation= for deep links and push notification targets.
 */
export default function ResaleHubMessagesRedirect({ searchParams }: Props) {
  const raw = searchParams?.conversation;
  const conversation = Array.isArray(raw) ? raw[0] : raw;
  const q = new URLSearchParams({ tab: "resale" });
  if (conversation) q.set("conversation", conversation);
  redirect(`/my-community/messages?${q.toString()}`);
}
