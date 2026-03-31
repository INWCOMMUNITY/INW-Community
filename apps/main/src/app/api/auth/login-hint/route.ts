import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { checkRateLimit, getClientIdentifier } from "@/lib/rate-limit";

/**
 * Returns whether an email is registered. Used after a failed credentials sign-in
 * so we can show "email not recognized" vs "wrong password" without changing NextAuth.
 */
export async function POST(req: NextRequest) {
  const key = `login-hint:${getClientIdentifier(req)}`;
  const { allowed } = checkRateLimit(key);
  if (!allowed) {
    return NextResponse.json({ error: "Too many requests. Try again in a minute." }, { status: 429 });
  }

  try {
    const body = await req.json();
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Valid email required." }, { status: 400 });
    }

    const member = await prisma.member.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: { id: true },
    });

    return NextResponse.json({ exists: !!member });
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
}
