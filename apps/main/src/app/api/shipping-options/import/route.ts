import { NextRequest, NextResponse } from "next/server";
import { getSessionForApi } from "@/lib/mobile-auth";
import { importRemoteShippingOptions, updateShippingOptionPrefs } from "@/lib/shipping-options";
import { z } from "zod";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  provider: z.enum(["ebay", "etsy"]),
});

export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "provider must be ebay or etsy" }, { status: 400 });
  }
  await updateShippingOptionPrefs(userId, {
    ...(parsed.data.provider === "ebay"
      ? { importEbayShippingOptions: true }
      : { importEtsyShippingOptions: true }),
  });
  const result = await importRemoteShippingOptions(userId, parsed.data.provider);
  return NextResponse.json(result);
}
