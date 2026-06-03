# Channel Sync Rules (Reference)

**Purpose:** Capture the sync behavior we established for **Wix** so Etsy, eBay, and Shopify can follow the same model for consistency.

**Related:** Setup/env vars live in [`STORE-SYNC-SETUP.md`](./STORE-SYNC-SETUP.md). Shared code lives under `apps/main/src/lib/channels/`.

**Status key:** ✅ implemented for Wix · 🔲 not yet generalized to other providers

---

## 1. Core model (all channels)

| Rule | Detail |
|------|--------|
| **Hub inventory** | One `StoreItem` holds the shared quantity. A sale on any channel decrements that number, then the new **absolute** quantity is pushed to every linked channel. |
| **Links, not copies** | `ChannelListingLink` ties one INW item to one external listing per provider. Sync only runs when `syncEnabled: true`. |
| **Adapter contract** | Each provider implements `ChannelAdapter` in `types.ts`: OAuth, CRUD listings, inventory, import list, sales poll, optional webhooks. |
| **Best-effort outbound** | Push failures are stored on the link (`syncStatus: "error"`, `syncError`) and logged — they must **not** crash the seller flow. |
| **Disconnect ≠ delete** | Disconnecting a channel stops sync; external listings stay on the marketplace. **Remove listing** in INW triggers `deleteListing`. |
| **SKU back-link** | On publish, set external SKU to the `StoreItem.id` so sales can be matched even if listing-id lookup fails. |

---

## 2. Conflict resolution (most recent wins)

Agreed with the seller during the Wix rebuild:

| Scenario | Winner |
|----------|--------|
| Only INW changed since last baseline | **Push** INW → channel |
| Only channel changed since last baseline | **Pull** channel → INW |
| Both changed | Side with the **newer timestamp** wins |
| Channel timestamp unknown | **INW wins** (push) |

**Implementation:** `resolveSyncDirection()` in `sync-baseline.ts`.

---

## 3. Baseline-driven differential sync

Replace naive “compare current values” sync. Store the last **agreed** state on each link:

| Field | Meaning |
|-------|---------|
| `syncBaselineHash` | SHA1 of INW content: title, description, price, photos |
| `syncBaselineQty` | Last agreed quantity |
| `syncBaselineAt` | Timestamp anchor for detecting remote edits |

**Detect changes:**

- **INW content changed:** current hash ≠ `syncBaselineHash`
- **Remote content changed:** `remoteUpdatedAt` > `syncBaselineAt`
- **Quantity differs:** `remote.quantity !== item.quantity` (only when `quantityKnown !== false`)

**Advance baseline only when sync actually succeeded:**

- After a verified push → update baseline (+ echo skew, see §5)
- After a successful pull → update baseline anchored to remote edit time
- After a **failed** push → **do not** advance baseline (next cron retries; INW never reverts)

**Legacy links:** If baseline is null on first reconcile, default hash/time to current INW state so the first pass is a no-op, not a mass pull.

**Status:** ✅ Wix (`reconcile-inbound-catalog.ts`, outbound, sync-inventory, pull-wix-inventory) · 🔲 Etsy/eBay/Shopify (baseline fields exist in schema; reconciler is Wix-only today)

---

## 4. Separate content from quantity

| Aspect | Fields | Why separate |
|--------|--------|--------------|
| **Content** | title, description, price, photos | Photo URLs get re-hosted by channels → value equality thrashes |
| **Quantity** | `quantity` | Numbers compare cleanly; different inbound paths |

**Content pull** → `applyRemoteContentToStoreItem()` (never touches qty).

**Quantity pull** → `applyRemoteQuantityToStoreItem()` (never touches title/price/photos).

**Status:** ✅ shared helpers · ✅ Wix uses them · 🔲 other providers still use older paths in places

---

## 5. Echo suppression after push

When we push INW → Wix, Wix’s `updatedDate` jumps to ~now. Without skew, the next cron would treat that as a remote edit and pull our own write back.

**Rule:** After a successful push, set `syncBaselineAt = now + SYNC_ECHO_SKEW_MS` (120 seconds).

**Status:** ✅ Wix + outbound/inventory pushes · 🔲 apply same pattern on other providers when baseline reconciler lands

---

## 6. Quantity sync paths

### Outbound (INW → all channels)

- Triggered on: listing save, **local (INW) sale**, refund/relist/cancel, sold-out propagation
- Push **absolute** quantity, not a delta (`sync-inventory.ts`)
- Idempotent: safe to push back to the channel that originated the sale

#### Where an INW sale fires the push (shared Stripe layer — applies to every channel)

A storefront sale must run the same absolute-qty push as a manual edit. This is wired once in the
Stripe layer; new channels inherit it automatically (no per-provider trigger code needed):

| Checkout flow | Fulfilled by | Push call |
|---------------|-------------|-----------|
| Hosted **Checkout Session** (platform) | `checkout.session.completed` webhook **and** `success-summary` (safety net) → `fulfillStoreOrdersFromCheckoutSession` | `syncStoreItemsAfterSale()` (awaited) |
| **PaymentIntent on the seller's Connect account** (storefront default — `storefront-checkout-intent`) | `payment_intent.succeeded` **Connect** webhook (`event.account` set) | `syncStoreItemsAfterSale()` (awaited) |

**Hard-won rules (these were the actual production bugs — June 2026):**

- **Know which webhook fulfills the sale.** The storefront uses **Connect PaymentIntents**, so sales are fulfilled by `payment_intent.succeeded`, *not* `checkout.session.completed`. `success-summary` only fulfills the `session_id` (hosted Checkout) path. Fixing the Checkout-Session path alone does nothing for storefront sales.
- **Await the push; don't fire-and-forget it.** `waitUntil`/detached promises get killed on serverless before a multi-call channel write finishes, leaving the channel stale while INW shows the sale. Collect the sold `storeItemId`s and `await syncStoreItemsAfterSale(ids, prefix)` before the handler returns.
- **Re-push on idempotent re-entry.** Two paths fulfill the same order (webhook + success-return; or Stripe redelivery). Whichever runs second finds the order already `paid` and returns early — it must still re-push inventory so a missed/failed first push self-heals.
- **Log per-provider results** (`post-sale channel inventory sync ok/failed`) so production can tell "trigger didn't fire" from "channel write failed".

### Inbound quantity — two lanes

| Lane | When | Direction | Wix status |
|------|------|-----------|------------|
| **Webhooks / targeted fetch** | Seller edits stock on channel, or inventory event | Channel → INW, then push to **other** channels (`skipProviders: [origin]`) | ✅ `pull-wix-inventory.ts` |
| **Cron catalog reconcile** | Scheduled backup (every 3 min) | **Push-only** INW → channel | ✅ Wix only |

**Critical rule (learned from production):** Cron must **not** pull quantity from catalog list APIs
when those APIs return stale or unknown stock. That caused INW to **revert** after a failed write.

**Critical backstop rule (June 2026 — the fix that finally made storefront→Wix reliable):** The cron
push must trigger on **INW-vs-baseline divergence**, not only on a readable remote difference:

```ts
const inwQtyChangedSinceBaseline =
  link.syncBaselineQty != null && item.quantity !== link.syncBaselineQty;
const qtyDiffers =
  (remoteQtyKnown && remote.quantity !== item.quantity) || inwQtyChangedSinceBaseline;
```

Why: classic **Wix v1** (and any channel whose list API returns `quantityKnown === false`) never
satisfies `remote.quantity !== item.quantity`, so the cron would *never* push. That left the live
sale webhook as the only path; if it was killed mid-write, nothing healed it. Pushing on baseline
divergence makes the cron a real backstop (INW→channel within ~3 min) without depending on the
flaky remote read. It stays **push-only** and the baseline only advances on a **verified** push, so
a failed/no-op write never reverts INW and simply retries next pass.

**Status:** ✅ Wix · 🔲 Etsy (webhook exists; no dedicated inventory pull) · 🔲 eBay (cron-only sales) · 🔲 Shopify (cron-only)

---

## 7. Content sync paths

| Trigger | Behavior |
|---------|----------|
| Seller saves in INW app | `updateStoreItemOnChannels()` — skip if `lastPushedHash` unchanged |
| Remote edit on channel | Pull winning content → `applyRemoteContentToStoreItem()` → push to **other** channels (skip origin) |
| Cron backup | Baseline diff + most-recent-wins (`reconcile-inbound-catalog.ts`) |

**Guards:**

- Never overwrite a valid local price with **zero** from a bad remote read (`apply-remote-listing.ts`)
- Title max 200 chars on pull
- Restock on channel reactivates `sold_out` INW listings (qty > 0 → `active`)

---

## 8. Deletion & visibility

| Remote state | INW behavior | Other channels |
|--------------|--------------|------------------|
| **Deleted** on channel | Mark INW sold out, qty 0 | Push 0 to others |
| **Hidden** (Wix: `visible: false`) | Treat as sold out (same as deleted for sync) | Push 0 to others |
| **Remove listing** in INW | Delete on all linked channels, drop links | — |

**Safety:** If `listRemoteListings` returns **empty**, do **not** mark every link removed (likely API/version failure).

**Status:** ✅ Wix · 🔲 define equivalent for Etsy (draft?), eBay (ended?), Shopify (archived/draft?)

---

## 9. Sales handling

1. Receive sale via webhook **or** `fetchRecentSales()` poll (cron every 3 min)
2. Dedupe with `channelSyncEvent` unique `(provider, externalEventId)`
3. Decrement shared `StoreItem.quantity`
4. Mark sold out if variants/qty warrant it
5. Push new absolute qty to **all** linked channels (including origin)

**Status:** ✅ all providers have `fetchRecentSales` · ✅ Etsy webhook · ✅ Wix webhooks · 🔲 eBay webhook · 🔲 Shopify webhook

---

## 10. Auto-import (channel → INW)

| Rule | Wix | Others (today) |
|------|-----|----------------|
| New remote listing → create INW `StoreItem` + link | ✅ on connect + cron | Manual import only |
| Requires active NWC storefront plan | ✅ | ✅ |
| Skip price ≤ $0 | ✅ | ✅ |
| Skip already-linked IDs | ✅ | ✅ |

**Status:** Wix auto-import is the template; Etsy/eBay/Shopify could opt in via `connection.config.autoImportInbound`.

---

## 11. Adapter implementation checklist

When building or hardening a provider adapter, implement these patterns from Wix:

### Required adapter methods

- [ ] `createListing` / `updateListing` / `deleteListing` / `updateInventory`
- [ ] `listRemoteListings` → populate `remoteUpdatedAt`, set `quantityKnown` honestly
- [ ] `fetchRecentSales`
- [ ] OAuth + token refresh (or app-instance token for Wix)

### Strongly recommended

- [ ] **`fetchProductQuantity(productId)`** — read live stock without relying on list APIs
- [ ] **`verifyWebhook` + `parseInboundEvent`** — low-latency inbound
- [ ] **Read-back verification** after inventory write — if API returns 200 but stock unchanged, throw (see `verifyWixQuantityApplied`)
- [ ] **Health/diagnostic endpoint** — connection, catalog mode, product count, `syncErrors`

### Mapping & writes

- [ ] Enable inventory tracking on create/update (`trackQuantity` / `trackInventory` / Shopify `inventory_management`)
- [ ] **Inventory-only PATCH** must not include price/title (Wix v1 lesson: zero-price stubs wiped real prices)
- [ ] Resolve **real variant IDs** for multi-option products; default variant GUID for single-SKU
- [ ] Never silently succeed when prerequisite GET fails — still attempt the write with best-known IDs
- [ ] Map descriptions from the correct field per API version (Wix v3: `plainDescription`)

### Resilience

- [ ] Detect and persist catalog/API version; retry on 428 / wrong-version errors
- [ ] Paginate list APIs with a high cap + log truncation warning
- [ ] Filter hidden/unpublished listings consistently
- [ ] Store errors on `ChannelListingLink.syncError` (≤500 chars) for My Items UI

### Baseline updates (on success)

- [ ] `createListing` / `updateListing` / `updateInventory` → set `syncBaselineHash`, `syncBaselineQty`, `syncBaselineAt`
- [ ] Webhook quantity pull → update baseline via `recordInventoryBaseline` pattern
- [ ] Failed writes → **do not** update baseline

### Sale trigger & backstop (shared infra — verify, don't rebuild)

- [ ] Confirm `updateInventory` is **awaited** wherever `syncStoreItemsAfterSale` runs (no detached promise)
- [ ] Confirm the cron reconciler pushes on **INW-vs-baseline** divergence (works even if `quantityKnown === false`)
- [ ] If the channel's list API returns reliable stock, set `quantityKnown: true`; otherwise leave it `false` and rely on the baseline-divergence push
- [ ] No per-channel sale-trigger code needed — the Stripe fulfill layer (§6) already calls the shared push for every linked provider

---

## 12. Wix-specific reference (do not copy blindly)

Wix has extra complexity other channels may not need:

| Topic | Rule |
|-------|------|
| **Catalog version** | Detect `V1_CATALOG` vs `V3_CATALOG` once per connection; never mix v1 and v3 endpoints (428) |
| **v1 reads** | `/stores/v1/products/query` + inventory v2 GET |
| **v1 writes** | `/stores/v2/inventoryItems/product/{id}` PATCH; fallback v1 product PATCH for inventory-only |
| **v3 writes** | `/stores/v3/products` + `/stores/v3/inventory-items` |
| **List qty** | v3 product list → `quantityKnown: false`; merge real qty from inventory search or `fetchProductQuantity` |
| **Hidden products** | `visible: false` → exclude from import; missing from list → sold out on INW |
| **Webhooks** | Orders (sales), product CRUD (content), inventory events (qty) — see `STORE-SYNC-SETUP.md` Part D |
| **Reconnect** | Disconnect + reconnect refreshes `siteId` and catalog version after deploy |

---

## 13. Etsy / eBay / Shopify — gap checklist

Use this when we pick up the next provider:

### Etsy

- [ ] Generalize `reconcile-inbound-catalog` (or provider branch) with baseline logic
- [ ] Dedicated inventory pull path (listing inventory API), not catalog list defaults
- [ ] Map `remoteUpdatedAt` from Etsy listing `last_modified_timestamp`
- [ ] Webhook → baseline update after quantity pull
- [ ] Read-back verify on `updateInventory`
- [ ] Define hidden/draft listing behavior (draft → don’t import? inactive → sold out?)

### eBay

- [ ] Same baseline reconciler + inventory read-back
- [ ] No webhook today — cron-only; consider Trading/Notification API later
- [ ] Map `remoteUpdatedAt` from item revision / LastModifiedTime
- [ ] Ended/unpublished listing → sold out on INW
- [ ] Business policies / merchant location already gated at publish

### Shopify

- [ ] Same baseline reconciler
- [ ] `fetchProductQuantity` via Inventory Levels API (location-aware)
- [ ] Webhooks: `inventory_levels/update`, `products/update`, `orders/paid`
- [ ] Draft/archived products → visibility rules
- [ ] Multi-location: respect `SHOPIFY_DEFAULT_LOCATION_ID`

---

## 14. Anti-patterns (never again)

These caused the Wix “finicky” bugs:

| Anti-pattern | Symptom | Fix |
|--------------|---------|-----|
| Compare photo URLs for equality | Endless push/pull loops | Baseline hash + `remoteUpdatedAt` |
| Pull qty from incomplete list API | INW reverts after app edit | Cron push-only qty; webhooks/targeted fetch for inbound |
| Optimistic baseline on failed write | Silent failure then revert | Advance baseline only after verified success |
| Inventory PATCH includes price fields | Price zeroed | Inventory-only body |
| Empty remote catalog → delete all links | Mass sold-out | Skip removal detection when list is empty |
| Push when local qty is 0 only | Wipes remote restocks | Removed; use baseline diff instead |
| Assume 200 OK = stock changed | Wix shows old qty | Read-back verification |
| Gate cron qty push only on a *readable* remote qty | Never syncs on v1/classic stores (list API has no stock) — stays stale forever | Also push on INW-vs-`syncBaselineQty` divergence |
| Fire-and-forget the post-sale push (`waitUntil`/detached) | Serverless kills it mid-write; channel stays stale while INW shows the sale | **Await** the push in the fulfill handler |
| Fix only the Checkout-Session fulfill path | Storefront (Connect PaymentIntent) sales never push | Wire the push into `payment_intent.succeeded` too |
| Skip channel sync when order already `paid` (idempotent re-entry) | A missed/failed first push never heals | Re-push inventory on re-entry for paid orders |

---

## 15. Cron & infrastructure

| Item | Value |
|------|-------|
| Cron path | `GET /api/cron/sync-channels` |
| Schedule | Every **3 minutes** |
| Order per connection | Sales → catalog reconcile → auto-import |
| Webhook role | Real-time; cron is backup |
| After env change | **Redeploy** main app |

---

## 16. Key source files

| File | Role |
|------|------|
| `sync-baseline.ts` | Content + meta hash, direction resolver, echo skew |
| `category-resolver.ts` | Fuzzy match remote category → INW preset or custom string |
| `category-map.ts` | INW label → provider taxonomy/collection cache |
| `variant-sync.ts` | Normalize options, fingerprint, sale matching |
| `shipping-map.ts` | Etsy per-rate shipping profile cache |
| `apply-remote-meta.ts` | Pull category, shipping, variants |
| `reconcile-inbound-meta.ts` | Two-way meta sync (all providers) |
| `reconcile-inbound-catalog.ts` | Two-way content + qty push (Wix) |
| `apply-remote-listing.ts` | Pull content/qty/removal guards |
| `outbound.ts` | Push create/update/delete |
| `sync-inventory.ts` | Absolute qty push to all links |
| `pull-wix-inventory.ts` | Webhook qty pull + baseline |
| `reconcile.ts` | Sales poll + dedupe |
| `stripe/fulfill-storefront-orders.ts` | Marks orders paid + `syncStoreItemsAfterSale()` (awaited post-sale push + logging) |
| `api/stripe/webhook/route.ts` | `payment_intent.succeeded` (Connect) and `checkout.session.completed` fulfillment → post-sale push |
| `types.ts` | Adapter contract, `RemoteListingSummary` |
| `wix/adapter.ts` | Reference adapter (version routing, verify, variants) |
| `wix/mapping.ts` | v1/v3 mapping, visibility, inventory bodies |

---

## 17. Category, shipping & product options (cross-channel meta)

**Status:** ✅ implemented across Etsy, eBay, Shopify, Wix

### Categories

- Remote category labels are fuzzy-matched to preset labels in `store-categories.ts` via `category-resolver.ts`.
- No match → stored as a **custom `StoreItem.category` string** on that listing only (no global category DB).
- Outbound: `category-map.ts` resolves INW label → provider taxonomy/collection (cached on `ChannelConnection.config.categoryMap`).
  - **Etsy:** `taxonomy_id` (seller taxonomy search)
  - **eBay:** leaf `categoryId` (Commerce Taxonomy suggest)
  - **Shopify:** `product_type`
  - **Wix:** collection name (create collection on site if missing)
- Inbound import/reconcile: `applyRemoteCategoryToStoreItem()` writes category + optional `etsyTaxonomyId` / `ebayCategoryId`.

### Shipping

- INW `shippingCostCents` (flat per-item rate) participates in `syncMetaHash`.
- **Etsy:** `shipping-map.ts` creates/reuses a shop shipping profile per rate bucket (`INW $X.XX`).
- **eBay / Shopify / Wix:** connection-level policies remain fallback; item rate included in outbound hash for retry when APIs support it.
- Inbound: `applyRemoteShippingToStoreItem()` when `shippingKnown !== false`.

### Product options (Size, Color, Material)

- **Cross-channel contract:** one option type per listing (e.g. Size) with `{ value, quantity }` rows. INW seller app and API enforce a single axis; multi-axis legacy data is collapsed to the first group on edit.
- Canonical INW shape: `[{ name, options: [{ value, quantity }] }]`.
- `variant-sync.ts`: normalize, fingerprint, `validateInwVariantsForSave()`, sale-to-option matching.
- **Seller save:** `updateStoreItemOnChannels` pushes option rows; **do not** run aggregate `syncInventoryToChannels` afterward (that would set every size to the total qty).
- **Sales / cron inventory:** `updateInventory` is variant-aware on Wix v1, Shopify, eBay, and Etsy (per-option stock, not pooled total on every row).
- **Etsy:** create/update inventory with taxonomy property values (`etsy/variants.ts`).
- **Shopify:** single-axis maps to `option1` + per-variant inventory levels.
- **Wix v1:** `productOptions` + per-variant stock via `buildWixV1OptionsBody` / `pushWixV1PerOptionInventory`.
- **eBay:** single-axis `variations[]` with per-value `shipToLocationAvailability.quantity`.
- Inbound Wix v1: variant `choices` object `{ "Size": "M" }` parsed in `wix/collections.ts`; meta reconcile backfills empty INW variants.
- Sales: `reconcile.ts` passes variant selection into `applyStoreItemDecrementAfterSale` when the channel exposes it.

### Meta reconcile

- `syncBaselineMetaHash` on `ChannelListingLink` tracks category + shipping + variants separately from content hash.
- `reconcile-inbound-meta.ts` runs for **all providers** on cron (most-recent-wins, baseline advances only on verified push/pull).

### Manual test matrix

| Test | Expected |
|------|----------|
| Import Wix product with Size options | INW shows Size rows with per-value qty (not aggregate only) |
| Import Wix product with unfamiliar category | INW gets fuzzy-matched preset **or** custom category string |
| Set category in INW app → save | Etsy/eBay/Shopify/Wix receive taxonomy/collection/product_type |
| Add Size options in INW → save | Options appear on linked Etsy/Shopify/Wix/eBay listings |
| Edit Medium qty in INW app → save | Wix Medium stock updates; other sizes unchanged |
| Edit option qty on Wix | INW updates via webhook/cron meta pull; other channels get push |
| Set shipping $5.99 in INW → Etsy | Listing uses/reuses `INW $5.99` shipping profile |
| Sell variant on Shopify | Correct INW option qty decrements; other channels push per-size stock |

---

*Last updated: June 2, 2026 — post-sale push reliability: Connect PaymentIntent fulfillment path, awaited (not fire-and-forget) push, idempotent re-entry re-push, and cron baseline-divergence backstop for classic/v1 stores. Plus single-axis options sync + no inventory wipe after option push.*
