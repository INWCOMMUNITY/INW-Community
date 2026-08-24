import { EtsyApiError, etsyDelete, etsyForm, etsyGet, setEtsyConnectionContext } from "./client";
import { etsyListingIsNotActive } from "./listing-exists";

type EtsyListingSnapshot = { state?: string; quantity?: number };

function etsyDeactivateQuantity(quantity: number | undefined): number {
  const qty = Number(quantity);
  return Number.isFinite(qty) && qty > 0 ? qty : 1;
}

async function readEtsyListing(
  accessToken: string,
  listingId: string
): Promise<EtsyListingSnapshot | null> {
  const listing = await etsyGet<EtsyListingSnapshot | null>(
    accessToken,
    `/listings/${encodeURIComponent(listingId)}`,
    { notFoundOk: true }
  );
  return listing ?? null;
}

/**
 * Take an Etsy listing off the shop: delete when Etsy allows it, otherwise deactivate.
 * Throws if the listing is still active afterward so INW can keep the channel link.
 */
export async function endEtsyListing(args: {
  accessToken: string;
  shopId: string;
  listingId: string;
  connectionId?: string;
}): Promise<void> {
  const { accessToken, shopId, listingId, connectionId } = args;
  if (connectionId) setEtsyConnectionContext(connectionId);

  const before = await readEtsyListing(accessToken, listingId);
  if (!before || etsyListingIsNotActive(before.state)) return;

  try {
    await etsyDelete(accessToken, `/listings/${encodeURIComponent(listingId)}`);
  } catch (e) {
    if (e instanceof EtsyApiError && e.status === 404) return;
    console.warn("[etsy] deleteListing failed; deactivating instead", {
      listingId,
      error: e instanceof Error ? e.message : String(e),
    });
    const qty = etsyDeactivateQuantity(before.quantity);
    try {
      await etsyForm(accessToken, `/shops/${shopId}/listings/${listingId}`, "PATCH", {
        state: "inactive",
        quantity: qty,
      });
    } catch (deactivateErr) {
      const msg =
        deactivateErr instanceof Error ? deactivateErr.message : String(deactivateErr);
      throw new Error(`Could not remove the Etsy listing. ${msg}`);
    }
    try {
      await etsyDelete(accessToken, `/listings/${encodeURIComponent(listingId)}`);
    } catch (e2) {
      if (!(e2 instanceof EtsyApiError && e2.status === 404)) {
        console.warn("[etsy] delete after deactivate failed", {
          listingId,
          error: e2 instanceof Error ? e2.message : String(e2),
        });
      }
    }
  }

  const after = await readEtsyListing(accessToken, listingId);
  if (after && !etsyListingIsNotActive(after.state)) {
    throw new Error(
      "Etsy listing is still active. Try Remove again, or deactivate it in Etsy Shop Manager."
    );
  }
}

/**
 * Hide an Etsy listing after INW sell-out. Does not DELETE — the ChannelListingLink stays.
 * Etsy inventory PUT rejects quantity 0, so inactive is the sell-out write.
 */
export async function deactivateEtsyListingForSellOut(args: {
  accessToken: string;
  shopId: string;
  listingId: string;
  connectionId?: string;
}): Promise<void> {
  const { accessToken, shopId, listingId, connectionId } = args;
  if (connectionId) setEtsyConnectionContext(connectionId);

  const before = await readEtsyListing(accessToken, listingId);
  if (!before || etsyListingIsNotActive(before.state)) return;

  await etsyForm(accessToken, `/shops/${shopId}/listings/${listingId}`, "PATCH", {
    state: "inactive",
    quantity: etsyDeactivateQuantity(before.quantity),
  });

  const after = await readEtsyListing(accessToken, listingId);
  if (after && !etsyListingIsNotActive(after.state)) {
    throw new Error(
      `Etsy listing ${listingId} is still active after sell-out deactivate`
    );
  }
}

/**
 * Apply qty 0 from INW: try listing quantity 0 when Etsy has no inventory products,
 * then deactivate so the shop no longer offers the item.
 */
export async function applyEtsySellOutInventory(args: {
  accessToken: string;
  shopId: string;
  listingId: string;
  connectionId?: string;
  tryListingQuantityZero?: boolean;
}): Promise<void> {
  const { accessToken, shopId, listingId, connectionId, tryListingQuantityZero } = args;
  if (connectionId) setEtsyConnectionContext(connectionId);

  if (tryListingQuantityZero) {
    try {
      await etsyForm(accessToken, `/shops/${shopId}/listings/${listingId}`, "PATCH", {
        quantity: 0,
      });
    } catch (e) {
      console.warn("[etsy] listing quantity 0 patch failed; deactivating", {
        listingId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  await deactivateEtsyListingForSellOut({
    accessToken,
    shopId,
    listingId,
    connectionId,
  });
}
