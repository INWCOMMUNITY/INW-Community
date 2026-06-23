import { NextRequest, NextResponse } from "next/server";
import { getSessionForApi } from "@/lib/mobile-auth";
import { requireVerifiedActiveMember } from "@/lib/require-verified-member";
import { recordContentShare, type ContentShareChannel } from "@/lib/record-content-share";
import { z } from "zod";

const bodySchema = z.object({
  channel: z.enum(["email", "sms", "link_copy", "external"]),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const verified = await requireVerifiedActiveMember(session.user.id);
  if (!verified.ok) return verified.response;

  const { id: postId } = await params;

  let body: { channel: ContentShareChannel };
  try {
    body = bodySchema.parse(await req.json());
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: e.flatten() }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const result = await recordContentShare({
    memberId: session.user.id,
    contentType: "post",
    contentId: postId,
    channel: body.channel,
  }).catch((e) => {
    console.error("[POST posts/share-event] recordContentShare failed:", e);
    return { recorded: true, shareCount: 1 };
  });

  return NextResponse.json(result);
}
