import { NextRequest, NextResponse } from "next/server";
import {
  adminCodeMatches,
  applyAdminSessionCookie,
  clearAdminSessionCookie,
  hasValidAdminSessionCookie,
  serverAdminCode,
  signAdminSession,
} from "@/lib/admin-session";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (await hasValidAdminSessionCookie(req)) {
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ ok: false }, { status: 401 });
}

export async function POST(req: NextRequest) {
  if (!serverAdminCode()) {
    return NextResponse.json({ error: "ADMIN_CODE is not configured" }, { status: 500 });
  }
  let code = "";
  try {
    const body = await req.json();
    code = typeof body?.code === "string" ? body.code.trim() : "";
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!adminCodeMatches(code)) {
    return NextResponse.json({ error: "Invalid code." }, { status: 401 });
  }
  const token = await signAdminSession();
  const res = NextResponse.json({ ok: true });
  applyAdminSessionCookie(res, token);
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  clearAdminSessionCookie(res);
  return res;
}
