# Sync Stores Rebuild - Reference Notes

This document captures key lessons learned from the previous marketplace sync implementation to inform the rebuild.

## Architecture Insights

### eBay Two-Surface Problem
- **Trading API** (Seller Hub) — where sellers edit listings
- **Inventory API** (View Item page) — where buyers see quantity/price
- Hub edits only update Trading; you MUST write to Inventory for View Item to reflect changes
- Use `POST /sell/inventory/v1/bulk_update_price_quantity` to update both warehouse and offer quantities

### Data Freshness
- **GetMyeBaySelling** returns fresher listing totals than GetItem for detecting changes (dirty scan)
- **GetItem** per-variation quantities can lag 10-20 minutes after a Hub edit
- Always compare multiple data sources when detecting changes

### SKU Consistency
- Maintain a canonical SKU format across all platforms (alphanumeric, max 32 chars)
- Store SKU mappings when external platforms use different SKU formats
- SKU is the primary join key for cross-platform inventory sync

## Platform-Specific Notes

### eBay
- OAuth tokens expire; implement refresh flow
- Platform Notifications (webhooks) need `?secret=` parameter for verification
- ItemRevised webhooks may not fire for all edit types
- Variation listings require per-SKU inventory management

### Etsy
- Requires who_made, when_made, is_supply fields
- Has its own taxonomy system for categories
- Shipping profiles are required

### Shopify
- Uses GraphQL Admin API
- Webhooks need HMAC verification
- Inventory tracked at location level

### Wix
- REST API with OAuth
- Collections map to categories

## Sync Flow Recommendations

### Outbound (INW → Marketplace)
1. Detect INW changes (updatedAt comparison)
2. Transform INW data to platform format
3. Call platform API to update
4. Store sync baseline for change detection

### Inbound (Marketplace → INW)
1. Receive webhook OR poll for changes
2. Verify the change is newer than last sync
3. Transform platform data to INW format
4. Apply to INW, respecting conflict rules

### Conflict Resolution
- Define clear rules for which source wins
- Consider: who edited last? which has fresher data?
- Log conflicts for manual review if ambiguous

## Error Handling

### Common Failure Modes
- Token expiration mid-sync
- Rate limiting
- Network timeouts
- Partial failures (some items sync, others fail)

### Recommendations
- Implement exponential backoff for retries
- Use a retry queue for failed syncs
- Log detailed error context for debugging
- Circuit breaker for repeated failures

## Testing Checklist

Before deploying sync:
- [ ] Simple listing: create, edit qty, edit price, delete
- [ ] Variation listing: create, edit per-variation qty, edit per-variation price
- [ ] Webhook reception and processing
- [ ] Token refresh flow
- [ ] Error recovery (simulate failures)
- [ ] Conflict detection and resolution

---

*This document was created during the marketplace sync gut operation on 2026-09-15 to preserve institutional knowledge for the rebuild.*
