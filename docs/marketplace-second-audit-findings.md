# Local seller marketplace — second audit findings

Date: 2026-08-25

This audit **proved wave-1 helpers in tests**, then closed remaining P0 holes in code. It does **not** claim a guaranteed freeze of eBay/Etsy stock. Claim **measurable** reliability: every connection reconciled, no burned/double-applied sales, pause only on dead OAuth, money matches inventory.

**Production evidence (Vercel cron logs / Neon):** not available in this environment (`gh`/authenticated Vercel were not used). After deploy, watch 7 days of `health_snapshot` rows: `lastCronDurationMs` &lt; 240s, no `skipped: lease_held` overlap, `staleReconcile` = 0, `sale_unmatched` &lt; 5/day, `pauseByReason` instead of a blob `lastError`.

Channel sales **never** become INW `StoreOrder`s. They only move pooled quantity. Fulfillment stays on Etsy/eBay/Wix/Shopify (not INW Shippo).

---

## Wave 1 — proven in tests (not yet in prod logs)

| Fix | Repro / proof | Who is hurt if it regresses | Log signature |
|---|---|---|---|
| Cron lease TTL ≥ 300s | `SYNC_CHANNELS_LOCK_TTL_MS` ≥ 320_000 | Later sellers starve when ticks overlap | `skipped: lease_held` |
| Sale claim then `appliedAt` | `inboundSaleClaimDecision` | Oversell / unique-burn | `claimed_unapplied`, `sale_applied` |
| Qty floor `quantity >= sold` | `applyStoreItemDecrementAfterSale` updateMany where | Negative qty | `sale_insufficient` |
| Stale `processing` webhook replay | `isStaleWebhookEvent` | Missed eBay/Etsy sale | stale webhook reprocess |
| Pause backoff + health UX | `pause-reason.test.ts` | Sellers reconnect every 5 minutes | `pause_classified` |
| Health snapshot | `/api/cron/sync-health-snapshot` writes `health_snapshot` + `pauseByReason` | Ops blind | `Degraded sync health detected!` |
| Circuit bypass at qty 0 | `shouldBypassCircuitForInventoryPush` | Sold-out not pushed | `circuit_open` skipped vs bypass |

---

## P0 closed this wave

### Cron / quantity

- **Lock TTL 280s vs maxDuration 300s** — **fixed.** TTL is 320s (`cron-job-lock.ts`). Repro: live run at t=290s, next tick stole the lock.
- **`lastReconciledAt` after failed sales fetch** — **fixed.** Cursor advances only in `reconcileConnectionSales` after a successful `fetchRecentSales`. `reconcileSingleConnection` no longer bumps on pause/failure. Repro: fetch throws → cursor moves → next tick looks back 10 minutes → dropped sales.
- **Webhook ∥ cron double-decrement** — **fixed.** Fresh unapplied claim → `in_flight` (skip). Stale unapplied (&gt;2 min) → retry. P2002 re-reads the row. Repro: ItemSold webhook and 5-minute cron same `externalEventId`.
- **eBay `sale_ack_absolute` without `appliedAt`** — **fixed.** Ack rows set `appliedAt`; claim decision treats ack as duplicate. Repro: webhook `applied === 0` then GetItem then sales poll decrements again.

### Stripe

- **Dashboard `charge.refunded` / disputes left the seller paid** — **fixed.** `restockAfterExternalRefund(orderId, stripe)` reverses `stripeSellerTransferId`, then restocks once.
- **Ledger vs Stripe** — **fixed.** Refunds debit `sellerBalance` (`type: return`) by the same `sellerTransferCents` fulfill credited.
- **Dead `assertSessionSubtotalMatchesOrderTotals`** — **called** in `fulfillStoreOrdersFromCheckoutSession`.
- **Sold-while-paying success page** — **fixed.** `success-summary` returns `soldWhilePaying`; order-success shows refund copy instead of “Your order was a success.”

### Shippo

- **`/api/cron/reconcile-shipments` 404** — **fixed.** Route exists; vercel.json already schedules it every 15 minutes.
- **`trackingStatus` never persisted** — **fixed.** Cron, seller GET `/api/shipping/track?shipmentId=`, and optional `POST /api/shipping/shippo-webhook` write status. `DELIVERED` can complete the ship leg (`nextStatusAfterFulfillmentConfirmations`).
- **Label save without transaction id** — **fixed.** Save rejects unless `shippoTransactionId` is present and GET transaction succeeds.

### Disconnect UX

- Mobile `SyncPausedBanner` and web/mobile List-on checkboxes use `healthKind`: **Reconnect** vs **Sync delayed** vs **Platform key — do not reconnect**.
- eBay listing-link webhook fallback **excludes `disconnected`**.
- Shopify offline token classifies as **reconnect** (`no_refresh_token`), not delayed.
- Health snapshot includes **`pauseByReason`**.

### Per-channel matrix (helpers + existing tests)

| Channel | Mishap | Result |
|---|---|---|
| Wix | POST then webhook import before link | Pass — `listing-link-claim.test.ts` (P2002 steal, no second StoreItem) |
| Etsy | $0 profile missing `destination_country_iso`; paid fallback | Pass — `shipping-map.test.ts` + matrix |
| eBay | Sale with only `legacyItemId` | Pass — `sale-link.test.ts` |
| eBay | Ended listing inventory retry | Pass — `listing-link-flags.test.ts` |
| eBay | Ack then later decrement | Pass — `inboundSaleClaimDecision` |
| Shopify | Unpaid/cancelled decrement | Pass — `isShopifySaleOrder` |
| Shopify | Missing `locationId` | Pass — strict throw in adapter (`Reconnect or set SHOPIFY_DEFAULT_LOCATION_ID`) |
| All | Webhook + cron same sale | Pass — `in_flight` / `duplicate` |
| All | Circuit open at sell-out | Pass — bypass at qty 0 |

Unmatched sales (`sale_unmatched`) still retry on the next successful fetch window (`lastReconciledAt − 10m`). They are not burned.

---

## Accept / residual

- **No 7-day green production snapshots yet.** Do not call cron “without fail” until those exist.
- **Shippo webhook** is optional. If `SHIPPO_WEBHOOK_TOKEN` is unset, the route returns 503; cron poll still runs. **Privacy/terms:** suggest noting that we receive carrier tracking updates from Shippo (already implied by labels). No new buyer PII form.
- **Safety buffer still off by default.** UI honesty is a quality follow-up, not a substitute for cron/quantity.
- **INW cannot freeze eBay/Etsy instantly.** Terms already mention cross-channel race; keep marketing to measurable coverage.

---

## Policy suggestion

Shippo track webhook is not new data collection from users; it is carrier status for labels we already create. If you add the webhook in production, a one-line Privacy mention of “carrier tracking updates from our shipping provider (Shippo)” is enough. Terms already cover marketplace facilitator / Connect refunds.
