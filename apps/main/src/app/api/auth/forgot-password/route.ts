import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "database";
import { checkRateLimit, getClientIdentifier } from "@/lib/rate-limit";
import { issuePasswordReset, PASSWORD_RESET_COOLDOWN_MS } from "@/lib/password-reset";

const bodySchema = z.object({
  email: z.string().email("Please enter a valid email address."),
});

/**
 * Request a password-reset email. Response is always generic to limit account enumeration.
 * Intentionally includes members who have not verified email yet so they can reset the password and finish signup.
 */
export async function POST(req: NextRequest) {
  const key = `forgot-password:${getClientIdentifier(req)}`;
  const { allowed } = checkRateLimit(key);
  if (!allowed) {
    return NextResponse.json({
      ok: true,
      message: "If that email is registered, we sent reset instructions.",
    });
  }

  try {
    const body = await req.json();
    const { email } = bodySchema.parse(body);
    const loginId = email.trim();
    const member = await prisma.member.findFirst({
      where: { email: { equals: loginId, mode: "insensitive" } },
      select: { id: true, email: true, status: true, passwordResetCompletedAt: true },
    });

    if (member && member.status !== "suspended") {
      const last = member.passwordResetCompletedAt;
      const onCooldown =
        last != null && Date.now() - last.getTime() < PASSWORD_RESET_COOLDOWN_MS;
      if (!onCooldown) {
        await issuePasswordReset(member.id);
      }
    }

    return NextResponse.json({
      ok: true,
      message: "If that email is registered, we sent reset instructions.",
    });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: e.errors[0]?.message ?? "Invalid email." }, { status: 400 });
    }
    console.error("[forgot-password]", e);
    return NextResponse.json({
      ok: true,
      message: "If that email is registered, we sent reset instructions.",
    });
  }
}
