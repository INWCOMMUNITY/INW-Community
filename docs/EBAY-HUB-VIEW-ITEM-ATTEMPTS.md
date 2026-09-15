# eBay Hub → View Item qty — attempt log

**Symptom (locked):** Seller Hub shows the new quantity. The public View Item page (`ebay.com/itm`) does not. Hub already saved; the buyer page reads a different eBay surface.

**Live fixture (✅ FIXED 2026-09-15):** Vintage Bear Clock listing `407217102811`, Custom label `inw407217102811`, 12 variations (Primary color × Size). After Hub revise: listing Quantity **24**, Hub preview **2 available**, live View Item Blue/Medium **2 available**. Fix: trust GetMyeBaySelling (24) over stale GetItem variations (120).

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
| 20 | Sep 15 | `b7c6ec18` | Fix `findOfferSkusByListingId` to check **both** `offer.listingId` and `offer.listing.listingId` (eBay returns either). Add extensive logging: SKU discovery source (group/probe/offer-list/none), alignment result (alignedSkuCount, unmatchedRows), per-SKU aspect matching failures. | Deployed. SKU discovery works, alignment works (`addressed: 12`), but `wrote: false`. | — |
| 21 | Sep 15 | `8ae49a1b` | Add per-row logging: `hubQty`, `offerQty`, `warehouseQty`, `shouldWrite`. Diagnose why `wrote: false`. | **ROOT CAUSE FOUND:** GetItem returns **stale** variation quantities (10) when Hub shows 2. All three API surfaces (Trading, offer, warehouse) return 10, so `shouldWrite: false`. eBay propagation lag. | Trusting GetItem for real-time Hub values |
| 22 | Sep 15 | `0e6101b3` | When cron detects `variants (qty)` change, schedule a **delayed retry** (5 minutes → 15 minutes) for the catch-up. By then, eBay APIs should have propagated the Hub values. | **Not enough** — 15 min delay scheduled but GetItem still stale. | Relying on eBay API lag to self-resolve |
| 23 | Sep 15 | `b40b194f` | **Use GetMyeBaySelling qty (24) instead of stale GetItem variation sum (120).** Dirty scan sees correct seller list qty (24); pass it through. When seller list differs from GetItem variation sum, trust seller list and distribute evenly (24/12=2). Force write with `overridePerVariationQty`. | **✅ SUCCESS** — View Item now shows 2 available (was 10). | GetItem variation qty as source of truth |

---

## ✅ RESOLVED (2026-09-15)

### Root cause

**eBay's GetItem API returns stale variation quantities.** Hub UI shows 2 per variation, but GetItem returns 10. All three API surfaces (Trading GetItem, Inventory offer, Inventory warehouse) are stale and agree, so `shouldWrite: false`.

**Key finding:** GetMyeBaySelling returns **correct** listing-level qty (24), while GetItem variations are stale (120 total, 10 each).

### Fix (attempt #23, commit `b40b194f`)

**Trust GetMyeBaySelling qty, not GetItem variations.**

1. Dirty scan calls GetMyeBaySelling, sees `sellerListTradingQty: 24` (correct)
2. GetItem variations still return 10 each = 120 total (stale)
3. When `sellerListHubQty (24) !== variationQtySum (120)`, detect stale GetItem
4. Distribute seller list qty evenly: `24 / 12 = 2` per variation
5. Force `bulk_update_price_quantity` with qty=2 per SKU
6. For eBay→INW sync: apply 2 per variation to INW (not stale 10)

### Verified

- ✅ Logs show `variationsAreStale: true`, `perVariationQty: 2`
- ✅ Logs show `hasQtyOverride: true`, `willWrite: true` for all 12 variations
- ✅ View Item updated from 10 → **2 available**

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
