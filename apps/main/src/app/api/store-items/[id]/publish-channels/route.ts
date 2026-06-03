import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { z } from "zod";
import { getSessionForApi } from "@/lib/mobile-auth";
import { publishStoreItemToChannels } from "@/lib/channels/outbound";
import { validateProvidersForPublish } from "@/lib/channels/connection-publish";
import type { ChannelProvider } from "@/lib/channels/types";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  providers: z
    .array(z.enum(["etsy", "ebay", "shopify", "wix"]))
    .min(1, "Select at least one store."),
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

  const providers = body.providers as ChannelProvider[];

  const connections = await prisma.channelConnection.findMany({
    where: { memberId: userId, provider: { in: providers } },
    select: {
      provider: true,
      status: true,
      etsyShippingProfileId: true,
      config: true,
    },
  });

  const validation = validateProvidersForPublish(connections, providers);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const channelSync = await publishStoreItemToChannels(item.id, item.memberId, { providers });

  return NextResponse.json({ ok: true, channelSync });
}
