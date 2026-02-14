import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { requireAdmin } from "@/lib/admin-auth";

const TOKEN_KEYS = [
  "primaryColor", "secondaryColor", "backgroundColor", "textColor", "headingColor", "linkColor",
  "buttonColor", "buttonTextColor", "buttonHoverColor", "buttonHoverTextColor",
  "headingFont", "bodyFont", "headingFontSize", "bodyFontSize", "lineHeight", "letterSpacing",
  "buttonBorderRadius", "buttonPadding", "sectionPadding", "columnGap", "maxWidth",
  "sectionAltColor",
];

export async function GET(req: NextRequest) {
  if (!requireAdmin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await prisma.designTokens.findMany({
    where: { key: { in: TOKEN_KEYS } },
  });
  const obj: Record<string, string> = {};
  rows.forEach((r) => { obj[r.key] = r.value; });
  return NextResponse.json(obj);
}

export async function PUT(req: NextRequest) {
  if (!requireAdmin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = (await req.json()) as Record<string, string>;
    for (const key of TOKEN_KEYS) {
      if (body[key] != null && typeof body[key] === "string") {
        await prisma.designTokens.upsert({
          where: { key },
          create: { key, value: body[key] },
          update: { value: body[key] },
        });
      }
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
