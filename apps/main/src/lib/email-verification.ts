import { createHash, randomInt } from "crypto";
import { prisma } from "database";
import { sendVerificationEmail } from "@/lib/send-verification-email";

/** TTL for six-digit codes (and shared `emailVerificationExpiresAt` on the member row). */
export const EMAIL_VERIFICATION_CODE_TTL_MS = 30 * 60 * 1000;

function getEmailVerificationPepper(): string {
  return (
    process.env.EMAIL_VERIFICATION_PEPPER?.trim() ||
    process.env.NEXTAUTH_SECRET?.trim() ||
    "dev-email-verification-pepper"
  );
}

export function hashEmailVerificationToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

/** Normalize user input to exactly 6 digits, or null if invalid. */
export function normalizeEmailVerificationCodeInput(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length !== 6) return null;
  return digits;
}

export function generateEmailVerificationSixDigitCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function hashEmailVerificationCode(email: string, code: string): string {
  const emailKey = email.trim().toLowerCase();
  const payload = `${getEmailVerificationPepper()}:${emailKey}:${code}`;
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    const ba = Buffer.from(a, "hex");
    const bb = Buffer.from(b, "hex");
    if (ba.length !== bb.length) return false;
    let diff = 0;
    for (let i = 0; i < ba.length; i += 1) {
      diff |= ba[i]! ^ bb[i]!;
    }
    return diff === 0;
  } catch {
    return false;
  }
}

export function codesMatchStoredHash(
  email: string,
  codeSixDigits: string,
  storedHash: string,
): boolean {
  return timingSafeEqualHex(hashEmailVerificationCode(email, codeSixDigits), storedHash);
}

/** Persist code (hashed), clear legacy link token, send email. */
export async function issueEmailVerification(memberId: string, email: string): Promise<void> {
  const code = generateEmailVerificationSixDigitCode();
  const hash = hashEmailVerificationCode(email, code);
  const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_CODE_TTL_MS);
  await prisma.member.update({
    where: { id: memberId },
    data: {
      emailVerificationCodeHash: hash,
      emailVerificationTokenHash: null,
      emailVerificationExpiresAt: expiresAt,
    },
  });
  try {
    await sendVerificationEmail({ to: email, code });
  } catch (e) {
    console.error("[issueEmailVerification] send failed", e);
  }
}
