import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { z } from "zod";
import { getSessionForApi } from "@/lib/mobile-auth";
import { publishStoreItemToChannels } from "@/lib/channels/outbound";
import type { ChannelProvider } from "@/lib/channels/types";

export const dynamic = "force-dynamic";
/** Wix media import can take tens of seconds for multiple photos. */
export const maxDuration = 120;

const bodySchema = z.object({
  providers: z
    .array(z.enum(["etsy", "ebay", "shopify", "wix"]))
    .min(1, "Select at least one store."),
  etsyTaxonomyId: z.coerce.number().int().positive().optional(),
  ebayCategoryId: z.coerce.number().int().positive().optional(),
  etsyWhoMade: z.string().min(1).optional(),
  etsyWhenMade: z.string().min(1).optional(),
  etsyIsSupply: z.boolean().optional(),
});

/**
 * POST: create external listings for an existing INW item on selected connected channels.
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

  const { id: storeItemId } = await params;

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.errors[0]?.message : "Invalid input";
    return NextResponse.json({ error: String(msg) }, { status: 400 });
  }

  const item = await prisma.storeItem.findFirst({
    where: { id: storeItemId, memberId: userId },
    select: { id: true, memberId: true, status: true },
  });
  if (!item) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }

  const categoryPatch: {
    etsyTaxonomyId?: number;
    ebayCategoryId?: number;
    etsyWhoMade?: string;
    etsyWhenMade?: string;
    etsyIsSupply?: boolean;
  } = {};
  if (body.etsyTaxonomyId != null) categoryPatch.etsyTaxonomyId = body.etsyTaxonomyId;
  if (body.ebayCategoryId != null) categoryPatch.ebayCategoryId = body.ebayCategoryId;
  if (body.etsyWhoMade) categoryPatch.etsyWhoMade = body.etsyWhoMade;
  if (body.etsyWhenMade) categoryPatch.etsyWhenMade = body.etsyWhenMade;
  if (body.etsyIsSupply != null) categoryPatch.etsyIsSupply = body.etsyIsSupply;
  if (Object.keys(categoryPatch).length > 0) {
    await prisma.storeItem.update({
      where: { id: item.id },
      data: categoryPatch,
    });
  }

  const providers = body.providers as ChannelProvider[];
  const channelSync = await publishStoreItemToChannels(item.id, item.memberId, { providers });

  return NextResponse.json({ ok: true, channelSync });
}
