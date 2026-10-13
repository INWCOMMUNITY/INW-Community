import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionForApi } from "@/lib/mobile-auth";
import { memberHasStorefrontListingAccess } from "@/lib/storefront-seller-access";
import { importRemoteShippingOptions } from "@/lib/shipping-options";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  provider: z.enum(["etsy", "shopify"]),
});

export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await memberHasStorefrontListingAccess(userId))) {
    return NextResponse.json({ error: "Seller access required" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "provider must be etsy or shopify" }, { status: 400 });
  }

  try {
    const result = await importRemoteShippingOptions(userId, parsed.data.provider);
    if (result.error && result.imported === 0 && result.updated === 0) {
      return NextResponse.json(
        { error: result.error, imported: 0, updated: 0, options: result.options },
        { status: 409 }
      );
    }
    return NextResponse.json(result);
  } catch (e) {
    console.error("[shipping-options/import]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Import failed" },
      { status: 500 }
    );
  }
}
