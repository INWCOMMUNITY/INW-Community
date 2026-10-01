import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionForApi } from "@/lib/mobile-auth";
import { requireVerifiedActiveMember } from "@/lib/require-verified-member";
import { shareStoreItemsToFeed } from "@/lib/listing-feed-collection";
import { validateText } from "@/lib/content-moderation";
import { createFlaggedContent } from "@/lib/flag-content";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  storeItemIds: z.array(z.string().min(1)).min(1).max(200),
  content: z.string().max(5000).optional().nullable(),
  photos: z.array(z.string()).optional().default([]),
  videos: z.array(z.string()).optional().default([]),
  links: z
    .array(z.object({ url: z.string().optional(), title: z.string().optional() }))
    .optional()
    .default([]),
  tags: z.array(z.string()).optional().default([]),
  taggedMemberIds: z.array(z.string()).optional().default([]),
  groupId: z.string().optional().nullable(),
});

export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const verified = await requireVerifiedActiveMember(session.user.id);
  if (!verified.ok) return verified.response;

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Select at least one listing to share." }, { status: 400 });
  }

  const content = body.content?.trim() || null;
  if (content) {
    const mod = validateText(content, "comment");
    if (!mod.allowed) {
      await createFlaggedContent({
        contentType: "post",
        contentId: null,
        reason: "slur",
        snippet: content.slice(0, 500),
        authorId: session.user.id,
      });
      return NextResponse.json(
        { error: mod.reason ?? "This content contains language that is not allowed." },
        { status: 400 }
      );
    }
  }

  const result = await shareStoreItemsToFeed(session.user.id, body.storeItemIds, {
    content,
    photos: body.photos,
    videos: body.videos,
    links: body.links,
    tags: body.tags,
    taggedMemberIds: body.taggedMemberIds,
    groupId: body.groupId,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result);
}
