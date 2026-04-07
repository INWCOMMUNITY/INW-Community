import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "database";
import { checkRateLimit, getClientIdentifier } from "@/lib/rate-limit";

const schema = z.object({
  email: z.string().min(1).max(200),
  password: z.string().min(1).max(200),
});

/**
 * After a failed NextAuth credentials sign-in, distinguishes wrong password vs unverified email.
 * Rate-limited; never reveals whether an email exists without a password attempt.
 */
export async function POST(req: NextRequest) {
  const key = `credential-status:${getClientIdentifier(req)}`;
  const { allowed } = checkRateLimit(key);
  if (!allowed) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  try {
    const body = await req.json();
    const { email, password } = schema.parse(body);
    const member = await prisma.member.findFirst({
      where: { email: { equals: email.trim(), mode: "insensitive" } },
      select: {
        passwordHash: true,
        emailVerifiedAt: true,
      },
    });

    if (!member) {
      return NextResponse.json({ exists: false });
    }

    const passwordMatch = await bcrypt.compare(password, member.passwordHash);
    return NextResponse.json({
      exists: true,
      passwordMatch,
      emailVerified: !!member.emailVerifiedAt,
    });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    }
    console.error("[credential-status]", e);
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
}
