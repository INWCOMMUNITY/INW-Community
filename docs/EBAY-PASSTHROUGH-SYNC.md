# eBay Passthrough Sync — Support Runbook

## Overview

Imported eBay listings use **passthrough sync**: live `GET inventory_item` aspects are preserved verbatim on every push. INW only overlays fields sellers edit here (title, price, quantity, photos, description) plus INW storefront category.

INW-created eBay listings still use the full Taxonomy form + `aspect-prep` remap pipeline.

## Detection

| Signal | Imported | INW-created |
|--------|----------|-------------|
| `ChannelListingLink.linkOrigin` | `"import"` | `"inw_create"` |
| SKU heuristic | `inw{legacyListingId}` | `StoreItem.id` |

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
2. `buildPassthroughInventoryBody` — live aspects + INW overlays
3. `PUT inventory_item` + `PUT offer` (price/qty/description)
4. Refresh `ebayInventoryAspects` cache on link

### INW-created

Unchanged: `prepareEbaySyncAspects` → Taxonomy validation → full inventory PUT.

### Quantity-only

`updateInventory` uses `bulk_update_price_quantity` (no aspect rewrite). Variant qty updates on imports use passthrough PUT.

## UI behavior

- **Imported:** item specifics read-only in web + mobile; banner directs sellers to eBay + Refresh from eBay
- **INW-created:** full eBay Listing Requirements form with required-field validation

## Debugging

```http
GET /api/channels/ebay/diagnose?storeItemId={id}
```

For imports, response includes `passthroughDebug`:

- `liveAspects` — current eBay inventory API
- `storedAspects` — INW `StoreItem.aspects` (display snapshot)
- `cachedInventoryAspects` — link cache

Compare these when sync fails. Passthrough should send `liveAspects` keys, not Taxonomy-remapped names.

## Regression matrix

| Case | Expected |
|------|----------|
| Import coin → edit price → sync | Price updates; aspects unchanged on eBay |
| Import coin → sell on Etsy → qty push to eBay | Qty updates; no aspect errors |
| INW-create coin → fill Taxonomy → publish | Full validation; first publish works |
| Refresh from eBay | Display aspects + cache update |

## Common errors (post-passthrough)

| Symptom | Likely cause | Action |
|---------|--------------|--------|
| `#25064` on import | Passthrough not active (missing `linkOrigin` or wrong SKU) | Backfill origin; confirm SKU is `inw*` |
| Qty mismatch | Baseline drift | Sync now; `?resetBaseline=1` on diagnose |
| Content failed | Title/photos/policy | Fix in INW; not aspect-related |

## Related code

- `apps/main/src/lib/channels/ebay/passthrough-push.ts`
- `apps/main/src/lib/channels/ebay/listing-origin.ts`
- `apps/main/src/lib/channels/ebay/adapter.ts` (passthrough branch in `upsertListing`)
