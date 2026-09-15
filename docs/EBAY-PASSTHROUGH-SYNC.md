# eBay Passthrough Sync — Support Runbook

## Overview

Imported eBay listings use **passthrough sync**: live `GET inventory_item` aspects are preserved verbatim on every **content** push. INW overlays title, photos, and description. Live quantity and price are written with `POST /sell/inventory/v1/bulk_update_price_quantity` against the pinned Inventory SKU — never a full inventory PUT.

INW-created eBay listings still use the full Taxonomy form + `aspect-prep` remap pipeline. Live qty/price on those listings uses the same `bulk_update` path.

Seller Hub listed remaining (`<Quantity>` − sold) and View Item remaining (`offer.availableQuantity`) can diverge. Hub edits do not update the public View Item page until INW copies Hub's numbers onto the offer.

## Detection

| Signal | Imported | INW-created |
|--------|----------|-------------|
| `ChannelListingLink.linkOrigin` | `"import"` | `"inw_create"` |
| SKU heuristic | `inw{legacyListingId}` | live pin / historical `StoreItem.id` |

Prefer `linkOrigin` when set. Run backfill if null:

```bash
npx tsx apps/main/scripts/backfill-ebay-link-origin.ts --limit=50
```

## Data model

- `linkOrigin` — `"import"` \| `"inw_create"`
- `ebayInventoryAspects` — cached `product.aspects` from last successful `GET inventory_item`

## Push paths

### Imported (`adapter.upsertListing` with `linkedSku`)

1. `GET inventory_item(sku)`
2. `buildPassthroughInventoryBody` — live aspects + INW title/photos
3. `PUT inventory_item` (content only; live availability preserved)
4. `PUT offer` with `availableQuantity` / `pricingSummary` omitted
5. `bulk_update_price_quantity` when INW qty or price changed
6. Refresh `ebayInventoryAspects` cache on link

### INW-created

Unchanged content path: `prepareEbaySyncAspects` → Taxonomy validation → inventory PUT that **preserves live availability** on update. Live qty/price via `bulk_update_price_quantity`.

### Quantity / price

`updateInventory` and Hub catch-up use `bulk_update_price_quantity` (no aspect rewrite). Variation listings send one call per variation SKU (do not flatten prices onto the parent).

### Hub → View Item catch-up

`ItemRevised` acks immediately. A delayed job `GetItem`s: if Hub listed remaining or Hub price disagrees with the live offer, `bulk_update` writes **Hub's** numbers, then INW pulls them and fans out to other channels (`skipProviders: ["ebay"]`).

## UI behavior

- **Imported:** item specifics read-only in web + mobile; banner directs sellers to eBay + Refresh from eBay
- **INW-created:** full eBay Listing Requirements form with required-field validation

## Debugging

```http
GET /api/channels/ebay/diagnose?storeItemId={id}
```

`qtyPriceSurfaces` compares Hub listed remaining, View Item / offer, warehouse inventory, and INW.

For imports, response also includes `passthroughDebug`:

- `liveAspects` — current eBay inventory API
- `storedAspects` — INW `StoreItem.aspects` (display snapshot)
- `cachedInventoryAspects` — link cache

Compare these when sync fails. Passthrough should send `liveAspects` keys, not Taxonomy-remapped names.

## Regression matrix

| Case | Expected |
|------|----------|
| Import coin → edit price → sync | Price updates via bulk_update; aspects unchanged on eBay |
| Import coin → sell on Etsy → qty push to eBay | Qty updates via bulk_update; no aspect errors |
| Hub qty/price revise | View Item matches Hub after catch-up; INW pulls Hub numbers |
| INW-create coin → fill Taxonomy → publish | Full form validation; first publish works |
| Refresh from eBay | Display aspects + `ebayInventoryAspects` cache update |

## Common errors (post-passthrough)

| Symptom | Likely cause | Action |
|---------|--------------|--------|
| `#25064` on import | Passthrough not active (missing `linkOrigin` or wrong SKU) | Backfill origin; confirm SKU is `inw*` |
| Hub new, View Item old | Catch-up did not write the offer | Diagnose `qtyPriceSurfaces`; confirm ItemRevised + retry queue |
| Qty mismatch | Baseline drift | Sync now; `?resetBaseline=1` on diagnose |
| Content failed | Title/photos/policy | Fix in INW; not aspect-related |

## Related code

- `apps/main/src/lib/channels/ebay/passthrough-push.ts`
- `apps/main/src/lib/channels/ebay/bulk-update-price-quantity.ts`
- `apps/main/src/lib/channels/ebay/qty-price-surfaces.ts`
- `apps/main/src/lib/channels/ebay/hub-catchup.ts`
- `apps/main/src/lib/channels/ebay/listing-origin.ts`
- `apps/main/src/lib/channels/ebay/adapter.ts` (passthrough branch in `upsertListing`)
