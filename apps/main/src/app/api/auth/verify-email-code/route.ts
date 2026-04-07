import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "database";
import { checkRateLimit, getClientIdentifier } from "@/lib/rate-limit";
import { codesMatchStoredHash, normalizeEmailVerificationCodeInput } from "@/lib/email-verification";

const bodySchema = z.object({
  email: z.string().email("Please enter a valid email address."),
  code: z.string().min(4).max(32),
});

export async function POST(req: NextRequest) {
  const ipKey = `verify-email-code:${getClientIdentifier(req)}`;
  const { allowed: ipOk } = checkRateLimit(ipKey);
  if (!ipOk) {
    return NextResponse.json({ error: "Too many attempts. Try again shortly." }, { status: 429 });
  }

  try {
    const body = await req.json();
    const { email, code: rawCode } = bodySchema.parse(body);
    const normalized = normalizeEmailVerificationCodeInput(rawCode);
    if (!normalized) {
      return NextResponse.json({ error: "Enter the 6-digit code from your email." }, { status: 400 });
    }

    const loginId = email.trim();
    const emailKey = `verify-email-code:${loginId.toLowerCase()}`;
    const { allowed: emailOk } = checkRateLimit(emailKey);
    if (!emailOk) {
      return NextResponse.json({ error: "Too many attempts for this email. Try again shortly." }, { status: 429 });
    }

    const member = await prisma.member.findFirst({
      where: { email: { equals: loginId, mode: "insensitive" } },
      select: {
        id: true,
        email: true,
        emailVerifiedAt: true,
        emailVerificationCodeHash: true,
        emailVerificationTokenHash: true,
        emailVerificationExpiresAt: true,
      },
    });

    if (!member || member.emailVerifiedAt) {
      return NextResponse.json({ error: "Invalid or expired code." }, { status: 400 });
    }

    const hasCode = !!member.emailVerificationCodeHash;
    const hasToken = !!member.emailVerificationTokenHash;
    if (!hasCode && !hasToken) {
      return NextResponse.json({ error: "Invalid or expired code." }, { status: 400 });
    }

    if (
      !member.emailVerificationExpiresAt ||
      member.emailVerificationExpiresAt < new Date()
    ) {
      return NextResponse.json({ error: "That code has expired. Request a new one." }, { status: 400 });
    }

    if (hasCode && member.emailVerificationCodeHash) {
      const ok = codesMatchStoredHash(member.email, normalized, member.emailVerificationCodeHash);
      if (!ok) {
        return NextResponse.json({ error: "Invalid code." }, { status: 400 });
      }
    } else if (hasToken) {
      // Legacy: only link flow; codes are not accepted for token-only rows.
      return NextResponse.json({ error: "Use the verification link we emailed you, or request a new code." }, { status: 400 });
    }

    await prisma.member.update({
      where: { id: member.id },
      data: {
        emailVerifiedAt: new Date(),
        emailVerificationTokenHash: null,
        emailVerificationCodeHash: null,
        emailVerificationExpiresAt: null,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: e.errors[0]?.message ?? "Invalid input." }, { status: 400 });
    }
    console.error("[verify-email-code]", e);
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
  }
}
