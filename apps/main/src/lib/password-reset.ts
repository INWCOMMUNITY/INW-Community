import { createHash, randomBytes } from "crypto";
import { prisma } from "database";
import { sendPasswordResetEmail } from "@/lib/send-password-reset-email";

export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000; // 1 hour

/** Minimum time after a successful forgot-password reset before we send another reset email. */
export const PASSWORD_RESET_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

export function hashPasswordResetToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

export function generatePasswordResetRawToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Issue a reset token and send email only if the member still exists and is not suspended.
 * Always uses the email stored on the row (never trusts a caller-supplied address).
 */
export async function issuePasswordReset(memberId: string): Promise<void> {
  const member = await prisma.member.findUnique({
    where: { id: memberId },
    select: { id: true, email: true, status: true },
  });
  if (!member || member.status === "suspended") {
    return;
  }

  const raw = generatePasswordResetRawToken();
  const hash = hashPasswordResetToken(raw);
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);
  await prisma.member.update({
    where: { id: member.id },
    data: {
      passwordResetTokenHash: hash,
      passwordResetExpiresAt: expiresAt,
    },
  });
  try {
    await sendPasswordResetEmail({ to: member.email, resetToken: raw });
  } catch (e) {
    console.error("[issuePasswordReset] send failed", e);
  }
}
