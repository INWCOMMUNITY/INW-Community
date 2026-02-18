import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { z } from "zod";

const bodySchema = z.object({
  contentType: z.enum(["post", "comment", "direct_message", "group_message", "resale_message"]),
  contentId: z.string().min(1),
  reason: z.enum(["political", "hate", "nudity", "csam", "other"]),
  details: z.string().max(2000).optional(),
});

export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const body = await req.json();
    const data = bodySchema.parse(body);
    await prisma.report.create({
      data: {
        reporterId: session.user.id,
        contentType: data.contentType,
        contentId: data.contentId,
        reason: data.reason,
        details: data.details?.trim() || null,
      },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof z.ZodError) {
      const msg = e.errors.map((err) => err.message).join(". ") || "Invalid input";
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to submit report" }, { status: 500 });
  }
}
