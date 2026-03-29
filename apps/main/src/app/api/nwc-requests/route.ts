import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { z } from "zod";
import { checkRateLimit, getClientIdentifier } from "@/lib/rate-limit";
import { getSessionForApi } from "@/lib/mobile-auth";
import { awardNwcFeedbackBadge, type EarnedBadge } from "@/lib/badge-award";

const bodySchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  email: z.string().email("Valid email is required"),
  /** Optional callback number; stored trimmed, max 40 chars. */
  phone: z.string().max(40).optional(),
  /** Optional on web modal; app Support & contact sends a subject line. */
  subject: z.string().max(200).optional(),
  message: z.string().min(1, "Message is required").max(10000),
});

export async function POST(req: NextRequest) {
  const key = `nwc-requests:${getClientIdentifier(req)}`;
  const { allowed } = checkRateLimit(key);
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again in a minute." },
      { status: 429 }
    );
  }

  try {
    const body = await req.json();
    const data = bodySchema.parse(body);

    const session = await getSessionForApi(req);
    const memberId = session?.user?.id ?? null;

    const subject = (data.subject ?? "").trim().slice(0, 200);
    const phone = (data.phone ?? "").trim().slice(0, 40);

    await prisma.nwcRequest.create({
      data: {
        memberId,
        name: data.name.trim(),
        email: data.email.trim().toLowerCase(),
        phone,
        subject,
        message: data.message.trim(),
      },
    });

    let earnedBadges: EarnedBadge[] = [];
    if (memberId) {
      earnedBadges = await awardNwcFeedbackBadge(memberId).catch(() => []);
    }

    return NextResponse.json({ ok: true, earnedBadges });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json(
        { error: e.errors[0]?.message ?? "Invalid input" },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: "Failed to send request" }, { status: 500 });
  }
}
