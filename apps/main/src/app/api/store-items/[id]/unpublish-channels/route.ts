import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { z } from "zod";
import { getSessionForApi } from "@/lib/mobile-auth";
import { unpublishStoreItemFromChannels } from "@/lib/channels/outbound";
import type { ChannelProvider } from "@/lib/channels/types";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  providers: z
    .array(z.enum(["etsy", "ebay", "shopify", "wix"]))
    .min(1, "Select at least one store."),
});

/**
 * POST: remove an INW item from selected connected channels (delete external listing, drop link).
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
    select: { id: true },
  });
  if (!item) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }

  const providers = body.providers as ChannelProvider[];
  const channelSync = await unpublishStoreItemFromChannels(storeItemId, providers);

  return NextResponse.json({ ok: true, channelSync });
}
