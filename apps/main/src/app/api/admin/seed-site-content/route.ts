import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { seedSiteContent } from "@/lib/seed-site-content";

/** POST: Seed SiteContent for editable pages that have no content. Skips pages that already have sections. */
export async function POST(req: NextRequest) {
  if (!requireAdmin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const results = await seedSiteContent();
    return NextResponse.json({ ok: true, seeded: results });
  } catch (e) {
    console.error("seed-site-content:", e);
    return NextResponse.json({ error: "Seed failed" }, { status: 500 });
  }
}
