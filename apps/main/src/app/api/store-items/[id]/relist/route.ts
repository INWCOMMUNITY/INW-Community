import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { z } from "zod";
import { getSessionForApi } from "@/lib/mobile-auth";
import { hasOptionQuantities, sumOptionQuantities } from "@/lib/store-item-variants";
import { memberHasStripeConnectForStorefront } from "@/lib/store-listing-stripe-rules";
import { gateLegacyInteractiveMutation } from "@/lib/commerce-foundation-cutover-http";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const bodySchema = z.object({
  quantity: z.number().int().min(1).max(9999).optional(),
});

/** Restore per-option rows to qty 1 each when a sold listing is reactivated. */
function variantsForRelist(variants: unknown, perOptionQty: number): unknown {
  if (!hasOptionQuantities(variants) || !Array.isArray(variants)) return variants;
  return variants.map((variant) => {
    const v = variant as { name?: string; options?: { value: string; quantity: number }[] };
    if (!v?.options?.length || typeof v.options[0] !== "object") return variant;
    return {
      ...v,
      options: v.options.map((o) => ({ ...o, quantity: perOptionQty })),
    };
  });
}

/**
 * POST: reactivate a sold_out StoreItem on INW (default qty 1).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const blocked = await gateLegacyInteractiveMutation();
  if (blocked) return blocked;

  const { id: itemId } = await params;

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json().catch(() => ({})));
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.errors[0]?.message : "Invalid input";
    return NextResponse.json({ error: String(msg) }, { status: 400 });
  }

  const existing = await prisma.storeItem.findFirst({
    where: { id: itemId, memberId: userId },
  });
  if (!existing) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }
  if (existing.status !== "sold_out") {
    return NextResponse.json(
      { error: "Only sold items can be re-listed. Edit active or ended items from My Items." },
      { status: 400 }
    );
  }

  const perOptionQty = body.quantity ?? 1;
  const connectOk = await memberHasStripeConnectForStorefront(userId);
  if (!connectOk) {
    return NextResponse.json(
      {
        error:
          "Complete Stripe Connect setup before listing items on the storefront. Go to Seller Hub → Payouts.",
      },
      { status: 403 }
    );
  }
  const { memberHasConnectPayoutsEnabled } = await import("@/lib/stripe-connect-payout-gate");
  if (!(await memberHasConnectPayoutsEnabled(userId))) {
    return NextResponse.json(
      {
        error:
          "Stripe Connect payouts are not enabled yet. Finish payout setup in Seller Hub → Payouts.",
      },
      { status: 403 }
    );
  }

  const update: { status: string; quantity: number; variants?: unknown } = {
    status: "active",
    quantity: perOptionQty,
  };
  if (hasOptionQuantities(existing.variants)) {
    const variants = variantsForRelist(existing.variants, perOptionQty);
    update.variants = variants;
    update.quantity = sumOptionQuantities(variants);
  }

  const item = await prisma.storeItem.update({
    where: { id: itemId },
    data: update as object,
  });

  return NextResponse.json({ ...item });
}
