import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import bcrypt from "bcryptjs";
import { issueMobileSessionForMemberId } from "@/lib/issue-mobile-session";
import { memberHasAppAccess } from "@/lib/member-public-visibility";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, password } = body;

    if (!email || !password || typeof email !== "string" || typeof password !== "string") {
      return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
    }

    const loginId = email.trim();
    const member = await prisma.member.findFirst({
      where: { email: { equals: loginId, mode: "insensitive" } },
    });

    if (!member) {
      return NextResponse.json({ error: "EMAIL_NOT_FOUND" }, { status: 401 });
    }

    if (member.status === "suspended") {
      return NextResponse.json({ error: "Account suspended" }, { status: 403 });
    }

    const ok = await bcrypt.compare(password, member.passwordHash);
    if (!ok) {
      return NextResponse.json({ error: "INVALID_PASSWORD" }, { status: 401 });
    }

    if (!(await memberHasAppAccess(member.id))) {
      return NextResponse.json({
        requiresEmailVerification: true,
        email: member.email,
      });
    }

    const session = await issueMobileSessionForMemberId(member.id);
    if ("error" in session) {
      const msg =
        session.error === "EMAIL_NOT_VERIFIED"
          ? "Verify your email before signing in. Check your inbox for a link from Northwest Community, or tap Resend on the sign-in screen."
          : session.error;
      const body =
        session.error === "EMAIL_NOT_VERIFIED"
          ? {
              error: "EMAIL_NOT_VERIFIED",
              code: "EMAIL_NOT_VERIFIED",
              message: msg,
            }
          : { error: msg };
      return NextResponse.json(body, { status: session.status });
    }

    return NextResponse.json(session);
  } catch (e) {
    const err = e as Error;
    console.error("[POST /api/auth/mobile-signin]", err);
    const message =
      process.env.NODE_ENV === "development"
        ? err.message || "Internal server error"
        : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
