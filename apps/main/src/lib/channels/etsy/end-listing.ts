import { EtsyApiError, etsyDelete, etsyForm, etsyGet, setEtsyConnectionContext } from "./client";
import { etsyListingIsNotActive } from "./listing-exists";

type EtsyListingSnapshot = { state?: string; quantity?: number };

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
    const qty = Number(before.quantity);
    try {
      await etsyForm(accessToken, `/shops/${shopId}/listings/${listingId}`, "PATCH", {
        state: "inactive",
        quantity: Number.isFinite(qty) && qty > 0 ? qty : 1,
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
