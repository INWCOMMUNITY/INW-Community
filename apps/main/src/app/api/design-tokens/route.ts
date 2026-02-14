import { NextResponse } from "next/server";
import { prisma } from "database";

const TOKEN_KEYS = [
  "primaryColor", "secondaryColor", "backgroundColor", "textColor", "headingColor", "linkColor",
  "placeholderColor",
  "buttonColor", "buttonTextColor", "buttonHoverColor", "buttonHoverTextColor",
  "headingFont", "bodyFont", "headingFontSize", "bodyFontSize", "lineHeight", "letterSpacing",
  "buttonBorderRadius", "buttonPadding", "sectionPadding", "columnGap", "maxWidth",
  "sectionAltColor",
];

export async function GET() {
  const rows = await prisma.designTokens.findMany({
    where: { key: { in: TOKEN_KEYS } },
  }).catch(() => []);
  const obj: Record<string, string> = {};
  rows.forEach((r) => { obj[r.key] = r.value; });
  return NextResponse.json(obj);
}
