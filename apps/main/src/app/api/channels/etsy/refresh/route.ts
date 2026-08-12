import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionForApi } from "@/lib/mobile-auth";
import { refreshEtsyListingByStoreItemId } from "@/lib/channels/etsy/pull-etsy-updates";
import { updateStoreItemOnChannels } from "@/lib/channels/outbound";
import { channelSyncSucceeded } from "@/lib/channels/sync-inventory";

export const dynamic = "force-dynamic";

const RefreshBodySchema = z.object({
  storeItemId: z.string().min(1),
  /** When true, push INW changes to Etsy after pulling remote updates. */
  pushToEtsy: z.boolean().optional(),
});

/**
 * POST: Refresh a StoreItem from its linked Etsy listing (two-way optional).
 *
 * Body: { storeItemId: string, pushToEtsy?: boolean }
 */
export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: z.infer<typeof RefreshBodySchema>;
  try {
    body = RefreshBodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { storeItemId, pushToEtsy } = body;

  const result = await refreshEtsyListingByStoreItemId(storeItemId, userId);
  if (!result) {
    return NextResponse.json({ error: "Store item not found or not linked to Etsy" }, { status: 404 });
  }

  let pushed = false;
  if (pushToEtsy) {
    pushed = channelSyncSucceeded(await updateStoreItemOnChannels(storeItemId), "etsy");
  }

  if (result.updated) {
    return NextResponse.json({
      ok: true,
      updated: true,
      pushed,
      changes: result.changes,
      message: `Refreshed from Etsy: ${result.changes.join(", ")}${pushed ? " (pushed to Etsy)" : ""}`,
    });
  }

  if (pushed) {
    return NextResponse.json({
      ok: true,
      updated: false,
      pushed: true,
      changes: [],
      message: "Pushed latest INW changes to Etsy",
    });
  }

  return NextResponse.json({
    ok: true,
    updated: false,
    pushed: false,
    changes: [],
    message: "Already up to date with Etsy",
  });
}
