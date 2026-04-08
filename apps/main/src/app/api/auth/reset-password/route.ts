import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "database";
import { checkRateLimit, getClientIdentifier } from "@/lib/rate-limit";
import { hashPasswordResetToken } from "@/lib/password-reset";

const bodySchema = z.object({
  token: z.string().min(1, "Reset link is invalid or expired."),
  password: z.string().min(8, "Password must be at least 8 characters.").max(128),
});

/** Does not require a verified email; unverified accounts use the same reset flow as verified ones. */
export async function POST(req: NextRequest) {
  const key = `reset-password:${getClientIdentifier(req)}`;
  const { allowed } = checkRateLimit(key);
  if (!allowed) {
    return NextResponse.json({ error: "Too many attempts. Try again in a minute." }, { status: 429 });
  }

  try {
    const body = await req.json();
    const { token, password } = bodySchema.parse(body);
    const hash = hashPasswordResetToken(token.trim());
    const member = await prisma.member.findFirst({
      where: { passwordResetTokenHash: hash },
      select: { id: true, passwordResetExpiresAt: true, status: true },
    });

    if (
      !member ||
      !member.passwordResetExpiresAt ||
      member.passwordResetExpiresAt < new Date() ||
      member.status === "suspended"
    ) {
      return NextResponse.json(
        { error: "This reset link is invalid or has expired. Request a new one from Forgot password." },
        { status: 400 }
      );
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const now = new Date();
    const updated = await prisma.member.updateMany({
      where: {
        id: member.id,
        passwordResetTokenHash: hash,
        passwordResetExpiresAt: { gt: now },
        status: { not: "suspended" },
      },
      data: {
        passwordHash,
        passwordResetTokenHash: null,
        passwordResetExpiresAt: null,
        passwordResetCompletedAt: now,
      },
    });

    if (updated.count === 0) {
      return NextResponse.json(
        { error: "This reset link is invalid or has expired. Request a new one from Forgot password." },
        { status: 400 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof z.ZodError) {
      const first = e.errors[0];
      return NextResponse.json({ error: first?.message ?? "Invalid input." }, { status: 400 });
    }
    console.error("[reset-password]", e);
    return NextResponse.json({ error: "Could not reset password. Try again." }, { status: 500 });
  }
}
