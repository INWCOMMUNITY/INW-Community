# eBay Hub → View Item qty — attempt log

**Symptom (locked):** Seller Hub shows the new quantity. The public View Item page (`ebay.com/itm`) does not. Hub already saved; the buyer page reads a different eBay surface.

**Live fixture (still failing as of 2026-09-15):** Vintage Bear Clock listing `407217102811`, Custom label `inw407217102811`, 12 variations (Primary color × Size). After Hub revise: listing Quantity **60**, Hub preview **5 available**, live View Item Blue/Small **10 available**. 60 is the listing **sum**; View Item is **per SKU**. Success for this listing is Blue/Small → **5**, not 60.

**What View Item actually reads:** Title and listing price still come from Trading (`Item.Title` / `StartPrice`) — a Hub revise shows immediately. Qty does **not**: buyer remaining is `min(warehouse shipToLocationAvailability.quantity, offer availableQuantity)` **per SKU**. A Hub qty save updates Trading only.

**Finding (2026-09-15):** Title and price update on View Item; qty does not. They are not the same INW route. Title → `PUT inventory_item` (and Hub Trading natively). Price **and** qty share `bulk_update_price_quantity`. If View Item price moves while qty does not, Hub StartPrice is landing natively (listing-level) and per-SKU `bulk_update` is not applying qty — eBay is not half-applying one payload.

Append a new row **before** trying the next fix. Do not reopen a row marked failed unless new evidence contradicts it.

---

## Attempts (oldest first)

| # | When | Commit | What we tried | Result | Do not repeat |
|---|------|--------|---------------|--------|---------------|
| 1 | Sep 12 | `ece3f792` | Stop inbound catch-up from writing **INW's stale qty** over a Hub edit | Hub could keep its number; View Item still stale | Treating INW as the source of View Item qty |
| 2 | Sep 12 | `5e1e4852` | Stop cron from pushing INW qty/price over a seller's eBay edit | Same split remained | Cron INW→eBay as the Hub→View Item fix |
| 3 | Sep 12 | `559c63ff` | Copy Seller Hub qty onto the live offer for **simple** listings | Did not cover variation listings; later undone by "stop writing" | Offer-only write for a 12-SKU group |
| 4 | Sep 12 | `35852a4f` | Stop ItemRevised webhook from writing qty over a Hub edit | Webhook stopped fighting Hub; View Item still stale | Ack-only ItemRevised with **no** follow-up Inventory write |
| 5 | Sep 12 | `16259141` | Stop cron/passthrough from overwriting Seller Hub qty | Hub stayed new; View Item stayed old | Passthrough PUT as the qty tool |
| 6 | Sep 14 | `54ed7187` then `c226ccf4` revert | Apply variant qty/prices on cron GetItem title pull | Reverted — mixed content pull with qty write | Cron GetItem title path as qty catch-up |
| 7 | Sep 14 | `389a56e6` then `a7b3ec53` revert | Read Hub SKU qty into INW without writing GetItem onto the offer | Reverted | Pull-only: Hub→INW without Inventory write |
| 8 | Sep 14 | `52c59054` | Copy Hub Trading qty onto the live offer without wiping Hub edits | Offer write came back; View Item still often stuck (warehouse, SKU, variations) | Offer-only verify; ignore warehouse |
| 9 | Sep 14 | `a84da07a` | Address the **live Inventory SKU** so Hub revises hit View Item | Helped simple listings when the pin was right; variation Custom Labels still missed | Rewriting live Custom Labels / hyphen parents as the qty fix |
| 10 | Sep 14 | `41dcb2c0` | **Stop writing Hub qty onto the offer** so View Item can "update itself" | **Failed.** Hub updates; View Item stays frozen. eBay does not copy Trading onto Inventory. | Stopping Inventory writes so Hub can "own" View Item |
| 11 | Sep 14 | `5c02c723` | Stop restamping INW qty so Hub can update View Item | **Failed.** Same as #10. | INW restamp vs Hub ownership as the root cause |
| 12 | Sep 14 | `129397fb` | Delayed ItemRevised ping + cron backup `PUT offer.availableQuantity` | Could unstick simple offer qty; warehouse ∩ variation pins still wrong; PUT offer is not `bulk_update` | PUT offer as the qty tool; `waitUntil` as the only delayed path |
| 13 | Sep 15 | `27f6d041` | Gut live qty/price/SKU sync: Hub owns remaining after first publish | **Failed.** Confirmed the two-writer split. Deleted `hub-view-item.ts`, `quantity.ts`, `variant-qty-catchup.ts`. | Restoring those modules; full `PUT inventory_item` for qty/price |
| 14 | Sep 15 | (ops / agents) | Blame View Item **CDN**, Shopify echo, Trading `ReviseInventoryStatus`, SKU hyphen rewrite, disconnect Shopify | Ruled out. CDN only after Hub = warehouse = offer. Shopify does not create the two eBay surfaces. Mixing Trading+Inventory diverges surfaces. | Any of those as first diagnosis |
| 15 | Sep 15 | `a116f78a` | Dirty-scan listed remaining (not QuantityAvailable-first); `bulk_update` warehouse **and** offer; verify both; empty `responses[]` = failure; Hub title/photos PUT before skip-eBay; `ebaySkuMap`; ItemRevised enqueues `ebay_hub_catchup` immediately | Detection/write path restored for listings we can **address**. Bear Clock still 10 on View Item. | Treating empty bulk_update as success; skip-eBay fan-out as the View Item write; dirty-scan QuantityAvailable-first |
| 16 | Sep 15 | (local, then folded into #17) | Variation catch-up required a **legal Hub Custom Label** per row. Blank/hyphen SKUs dropped; parent `inw{legacyId}` `bulk_update` never hits Blue/Small | **Failed** on this listing (variation labels blank/hyphen; parent is the group key) | Parent group key as a variation offer SKU; dropping option rows without Custom Labels |
| 17 | Sep 15 | `d74a7305` | Option-value match (Hub `Primary color` vs Inventory `Color`); never address parent group key; lookup group `inw{legacyId}`; probe `inw{legacyId}vN` if group GET empty; skip parent `/offer?sku=` 400 before variant writes | **Not verified on live listing yet.** Deployed to `main`. Next Hub revise after Vercel should move Blue/Small 10 → 5. | Writing listing total **60** onto every variant |
| 18 | Sep 15 | (diagnosis, no code) | Side-by-side title vs price vs qty routes after seller reported title+price live, qty not | Title is Trading + optional content PUT. Price is listing-level Trading StartPrice (View Item shows it without Inventory). Qty is per-SKU Inventory only. INW `bulk_update` sends price and qty together — price succeeding on View Item does not mean that call ran. | Treating qty as "the same Hub revise path as price"; adding a separate price-only writer |
| 19 | Sep 15 | `c950be91` | Add `findOfferSkusByListingId` fallback: when group lookup and `inw{id}vN` probe both fail, paginate all offers and find the ones whose `listing.listingId` matches. Handles seller-migrated listings with arbitrary SKUs. Better logging (`liveGroupSkuSample`, `discoveredSkus`, warning when no SKUs found). | **Ran — still stuck.** User reported "all qtys were changed to 5 on every variable" but View Item still 10. Possible bug in offer listing ID extraction. | — |
| 20 | Sep 15 | `b7c6ec18` | Fix `findOfferSkusByListingId` to check **both** `offer.listingId` and `offer.listing.listingId` (eBay returns either). Add extensive logging: SKU discovery source (group/probe/offer-list/none), alignment result (alignedSkuCount, unmatchedRows), per-SKU aspect matching failures. | **Deploying now.** Watch Vercel logs for `[ebay] Hub→View Item catch-up: SKU discovery` and `alignment result`. | — |

---

## Still open (do not skip)

1. **Check new logging from `b7c6ec18`** in Vercel logs after the next Hub revise:
   - `[ebay] Hub→View Item catch-up: SKU discovery` — should show `source` (group/probe/offer-list/none) and `liveGroupSkuCount`
   - `[ebay] findOfferSkusByListingId completed` — should show `foundCount` and `foundSkus`
   - `[ebay] alignVariantRowsToLiveEbayInventory completed` — should show `matchedByAspects` and `unmatchedRowCount`
   - `[ebay] Hub→View Item catch-up: alignment result` — should show `alignedSkuCount`
2. If `source: "none"` and `liveGroupSkuCount: 0`: all three SKU discovery methods failed. Check:
   - Does the listing actually have Inventory offers? (imported before Inventory API existed?)
   - Are the offer listing IDs stored differently?
3. If SKUs found but `alignedSkuCount: 0` or `matchedByAspects: 0`: alignment by aspects failed:
   - Check `[ebay] alignVariantRows: no aspects for SKU` — variation inventory_items may not have aspects
   - Check `[ebay] alignVariantRows: no match for SKU` — aspects might not contain Color/Size
4. If `addressed === 0`: no variation row got a SKU to write. Check `ebayCatchupVariantAddress` returning null.
5. If `wrote === false` but `addressed > 0`: pin found, `bulk_update` skipped or verify failed. Diagnose warehouse vs offer vs Hub per SKU.
6. If warehouse = offer = Hub 5 and View Item still 10: **then** CDN / hard-refresh.
7. Webhook: is `ItemRevised` arriving? If not, cron `ebay_hub_catchup` / GetMyeBaySelling listed-remaining dirty-scan must fire.
8. Live token dumps from this machine have failed (`noToken` / decrypt blocked). Production logs + diagnose route are the evidence path.

## Diagnose

```http
GET /api/channels/ebay/diagnose?storeItemId={id}
```

Compare Hub listed remaining, warehouse, offer, `viewItemQty = min(warehouse, offer)`, INW, mapped pin, per-SKU rows.

## Related

- Rules summary: `docs/CHANNEL-SYNC-RULES.md` (eBay View Item vs Seller Hub)
- Runbook: `docs/EBAY-PASSTHROUGH-SYNC.md`
- Catch-up: `apps/main/src/lib/channels/ebay/bulk-update-price-quantity.ts` (`catchupEbayListingQtyPrice`)
- Surfaces: `apps/main/src/lib/channels/ebay/qty-price-surfaces.ts`
- Retry: `ebay_hub_catchup` in `hub-catchup.ts`
