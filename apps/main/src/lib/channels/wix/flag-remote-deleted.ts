import { prisma } from "database";
import { getConnectionContext } from "../connection";
import {
  isRemoteDeletedPending,
  persistRemoteDeletedPending,
} from "../listing-link-flags";
import type { ChannelConnectionContext } from "../types";
import { setWixConnectionContext } from "./client";
import { wixProductIsGone } from "./listing-exists";

type WixLinkToCheck = {
  id: string;
  externalListingId: string;
  conflictDetails: unknown;
  storeItem: { status: string };
};

export async function flagGoneWixLinks(
  ctx: ChannelConnectionContext,
  links: WixLinkToCheck[]
): Promise<number> {
  let removed = 0;
  for (const link of links) {
    if (link.storeItem.status === "sold_out" || link.storeItem.status === "inactive") continue;
    if (isRemoteDeletedPending(link.conflictDetails)) continue;
    const gone = await wixProductIsGone(ctx, link.externalListingId);
    if (!gone) continue;
    const flagged = await persistRemoteDeletedPending({
      linkId: link.id,
      conflictDetails: link.conflictDetails,
      provider: "wix",
    });
    if (flagged) {
      console.warn("[channels] Wix product gone; waiting for seller decision", {
        linkId: link.id,
        externalListingId: link.externalListingId,
      });
      removed += 1;
    }
  }
  return removed;
}

/** Lightweight My Items / webhook path: probe linked Wix products without listing the whole catalog. */
export async function flagGoneWixListingsForConnection(connection: {
  id: string;
  memberId: string;
  provider: string;
  status: string;
  accessTokenEncrypted: string | null;
  refreshTokenEncrypted: string | null;
  tokenExpiresAt: Date | null;
  externalShopId: string | null;
  etsyShippingProfileId: string | null;
  config?: unknown;
}): Promise<{ removed: number }> {
  if (connection.provider !== "wix") return { removed: 0 };
  setWixConnectionContext(connection.id);
  const ctx = await getConnectionContext(connection);
  if (!ctx) return { removed: 0 };

  const links = await prisma.channelListingLink.findMany({
    where: { connectionId: connection.id, provider: "wix", syncEnabled: true },
    select: {
      id: true,
      externalListingId: true,
      conflictDetails: true,
      storeItem: { select: { status: true } },
    },
  });
  const removed = await flagGoneWixLinks(ctx, links);
  return { removed };
}
