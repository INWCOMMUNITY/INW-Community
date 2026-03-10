# Verification checklist – recent fixes

Use this to confirm all fixes are in place and why errors might persist after rebuild.

## 1. Both API and mobile must be updated

- **Mobile app** calls `EXPO_PUBLIC_API_URL` (dev) or **https://www.inwcommunity.com** (release).
- If you run a **built/release** app, it talks to the **deployed** API. Changes only in your local `apps/main` will not apply until you **deploy** the main app.
- If you run **Expo dev** with a local API, set `EXPO_PUBLIC_API_URL` to your local server (e.g. `http://YOUR_IP:3000`) and ensure **both** are running with the latest code.

So: **rebuild and redeploy the main (Next.js) API** wherever the app points (e.g. inwcommunity.com), then rebuild the mobile app.

---

## 2. One-time fix: clear invalid Stripe Connect ID (universal account)

If the universal account still has `stripe_connect_account_id = 'acct_1T7kVMBn18UmZSGv'` and that Stripe account no longer exists, you can clear it once so the app stops hitting Stripe with a bad ID:

```sql
-- Run against your database (e.g. via psql or your DB UI)
UPDATE member
SET stripe_connect_account_id = NULL
WHERE email = 'universal@nwc.local'
  AND stripe_connect_account_id IS NOT NULL;
```

After this, the next time the universal user opens Seller Hub / My Funds they will see “complete setup” instead of “no such account”. The API changes above will also clear this ID automatically when any Stripe call returns “no such account”, but the SQL fix is immediate.

---

## 3. Files that must contain the fixes

### API (apps/main)

| File | What to check |
|------|----------------|
| `src/app/api/members/[id]/route.ts` | No `status: "active"` in `findUnique`; has `getSessionForApi` + privacy handling. |
| `src/app/api/seller-hub/pending-actions/route.ts` | Returns `soldCount`; in Stripe `catch`, checks `accountGone` and updates `stripeConnectAccountId` to `null`. |
| `src/app/api/store-orders/[id]/route.ts` | GET wrapped in try/catch and returns JSON error on 500. |
| `src/app/api/me/suggested-friends/route.ts` | Uses `(await getSessionForApi(req)) ?? (await getServerSession(authOptions))`. |
| `src/app/api/stripe/connect/status/route.ts` | In catch, checks `accountGone` and sets `stripeConnectAccountId` to `null`. |
| `src/app/api/stripe/connect/express-dashboard/route.ts` | On account-gone error, sets `stripeConnectAccountId` to `null` and returns 400. |
| `src/app/api/seller-funds/route.ts` | GET and POST: on Stripe “account gone” error, update member to `stripeConnectAccountId: null` and return clear error. |

### Mobile (apps/mobile)

| File | What to check |
|------|----------------|
| `app/event/[slug].tsx` | Button text: “Share” (not “Share with friend”); “Invite Friends” (not “Invite friends”). |
| `app/seller-hub/store/items/index.tsx` | `statusLabel`: “Active” only when `status === "active" && quantity > 0`; otherwise “Ended” / “Out of stock” / “Sold”. |
| `app/seller-hub/store/sold.tsx` | `useFocusEffect` calls `AsyncStorage.setItem(SOLD_ITEMS_VIEWED_KEY, ...)`. |
| `components/SellerHubSideMenu.tsx` | Fetches `soldCount` and `AsyncStorage.getItem(SOLD_ITEMS_VIEWED_KEY)`; `soldItemsAlert = soldCount > 0 && !soldItemsViewedAt`. |
| `app/profile-edit.tsx` | Has `privacyLevel` state; “Profile settings” section with “Private profile” Switch; load/save `privacyLevel` in GET and PATCH. |

---

## 4. Quick grep checks (from repo root)

```bash
# API: member profile no longer filters by status
grep -n "where: { id }" apps/main/src/app/api/members/\[id\]/route.ts

# API: pending-actions clears Stripe ID on account gone
grep -n "accountGone" apps/main/src/app/api/seller-hub/pending-actions/route.ts

# API: seller-funds clears Stripe ID
grep -n "accountGone" apps/main/src/app/api/seller-funds/route.ts

# Mobile: event Share / Invite Friends
grep -n "Share\"\|Invite Friends" apps/mobile/app/event/\[slug\].tsx

# Mobile: statusLabel Active only when live
grep -n "status === \"active\" && item.quantity" apps/mobile/app/seller-hub/store/items/index.tsx
```

If any of these return no matches, the corresponding fix is missing.

---

## 5. After deploying

1. Deploy the main app (so the API routes above are live).
2. Clear the universal account’s Stripe ID once (section 2) if you still see “no such account”.
3. Rebuild the mobile app (dev or release) and test:
   - Leaderboard → tap member → profile loads.
   - My Friends → Discover/Browse members and add friend.
   - Event → “Share” and “Invite Friends” labels.
   - Seller Hub → Sold Items exclamation after viewing sold page.
   - Order details (as buyer/seller) no server crash.
   - My Funds / universal account: no “no such account” after DB clear + API deploy.
   - My Items: only live listings show “Active”.
