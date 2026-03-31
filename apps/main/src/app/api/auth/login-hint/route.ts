import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { checkRateLimit, getClientIdentifier } from "@/lib/rate-limit";

/**
 * Returns whether a login id (email or admin-style id like NWCADMIN57611) is registered.
 * Used after a failed credentials sign-in so we can show "not recognized" vs "wrong password".
 */
export async function POST(req: NextRequest) {
  const key = `login-hint:${getClientIdentifier(req)}`;
  const { allowed } = checkRateLimit(key);
  if (!allowed) {
    return NextResponse.json({ error: "Too many requests. Try again in a minute." }, { status: 429 });
  }

  try {
    const body = await req.json();
    const loginId = typeof body.email === "string" ? body.email.trim() : "";
    if (!loginId || loginId.length > 200) {
      return NextResponse.json({ error: "Login id required." }, { status: 400 });
    }
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(loginId);
    const isPlainLoginId = /^[a-zA-Z0-9._-]{3,128}$/.test(loginId);
    if (loginId.includes("@")) {
      if (!isEmail) {
        return NextResponse.json({ error: "Invalid email." }, { status: 400 });
      }
    } else if (!isPlainLoginId) {
      return NextResponse.json({ error: "Invalid login id." }, { status: 400 });
    }

    const member = await prisma.member.findFirst({
      where: { email: { equals: loginId, mode: "insensitive" } },
      select: { id: true },
    });

    return NextResponse.json({ exists: !!member });
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
}
