import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "database";
import { checkRateLimit, getClientIdentifier } from "@/lib/rate-limit";
import { issueEmailVerification } from "@/lib/email-verification";

const bodySchema = z.object({
  email: z.string().email("Please enter a valid email address."),
});

/**
 * Resend verification email. Always returns a generic success message to avoid email enumeration.
 */
export async function POST(req: NextRequest) {
  const key = `resend-verification:${getClientIdentifier(req)}`;
  const { allowed } = checkRateLimit(key);
  if (!allowed) {
    return NextResponse.json({ ok: true, message: "If that email is registered, we sent a code." });
  }

  try {
    const body = await req.json();
    const { email } = bodySchema.parse(body);
    const loginId = email.trim();
    const member = await prisma.member.findFirst({
      where: { email: { equals: loginId, mode: "insensitive" } },
      select: { id: true, email: true, emailVerifiedAt: true },
    });

    if (member && !member.emailVerifiedAt) {
      await issueEmailVerification(member.id, member.email);
    }

    return NextResponse.json({
      ok: true,
      message: "If that email is registered, we sent a verification code.",
    });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: e.errors[0]?.message ?? "Invalid email." }, { status: 400 });
    }
    console.error("[resend-verification]", e);
    return NextResponse.json({ ok: true, message: "If that email is registered, we sent a code." });
  }
}
