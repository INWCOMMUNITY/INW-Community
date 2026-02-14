import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { requireAdmin } from "@/lib/admin-auth";

const ALLOWED_KEYS = ["quoteOfTheWeek", "platform_business", "admin_business", "time_away"];

export async function GET(req: NextRequest) {
  if (!requireAdmin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const key = searchParams.get("key");
  if (key && ALLOWED_KEYS.includes(key)) {
    const row = await prisma.siteSetting.findUnique({ where: { key } });
    return NextResponse.json(row ? (row.value as object) : null);
  }
  const rows = await prisma.siteSetting.findMany({
    where: { key: { in: ALLOWED_KEYS } },
  });
  const obj: Record<string, unknown> = {};
  rows.forEach((r) => { obj[r.key] = r.value; });
  return NextResponse.json(obj);
}

export async function PATCH(req: NextRequest) {
  if (!requireAdmin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await req.json();
    const key = body?.key as string;
    const value = body?.value;
    if (!key || !ALLOWED_KEYS.includes(key)) {
      return NextResponse.json({ error: "Invalid key" }, { status: 400 });
    }
    await prisma.siteSetting.upsert({
      where: { key },
      create: { key, value: value ?? {} },
      update: { value: value ?? {} },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
