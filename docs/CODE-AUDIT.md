# Full Code Audit

**Date:** March 14, 2026  
**Scope:** TypeScript, ESLint, and build checks across `database`, `types`, `design-tokens`, `main`, `admin`, and `mobile`.

---

## Summary

| Package           | TypeScript | Lint        | Build / Notes                    |
|-------------------|------------|------------|-----------------------------------|
| database          | ✅ Pass    | —          | Prisma generate + tsc            |
| types             | ✅ Pass    | —          | tsc --noEmit                     |
| design-tokens     | ✅ Pass    | —          | tsc --noEmit                     |
| main (website)    | ✅ Pass    | ⚠️ Warnings| next lint; next build (long)     |
| admin             | ✅ Pass    | —          | tsc --noEmit                     |
| mobile            | ✅ Pass*   | —          | tsc --noEmit (*after fixes below) |

**Root command:** `pnpm run check` (runs all of the above in sequence; main build can take several minutes).

---

## Fixes Applied (Mobile App)

The following TypeScript errors were fixed so that `pnpm exec tsc --noEmit` passes in `apps/mobile`:

1. **`app/cart.tsx`**
   - **Line 345:** `resolvedShippingAddress.aptOrSuite` was `string | undefined` where the payload expected `string`. Updated to `?? ""` so it is always a string.
   - **Line 578:** `AddressSearchInput`’s `onChange` passes `AddressValue` (optional fields). State was `{ aptOrSuite: string }`. Normalized when calling `setShippingAddress`: `{ street: addr.street ?? "", aptOrSuite: addr.aptOrSuite ?? "", ... }`.

2. **`app/messages/[id].tsx`**
   - **Line 668:** `autoComplete="sentences"` is not in React Native’s allowed union. Changed to `autoComplete="off"`.

3. **`app/seller-hub/_layout.tsx`**
   - **Line 20:** Comparison `last === "business-hub"` was flagged because the segment type didn’t include `"business-hub"`. Updated to `String(last) === "business-hub"`.

4. **`app/seller-hub/orders/index.tsx`**
   - **Line 116:** `Alert` was used but not imported. Added `Alert` to the `react-native` import.
   - **Line 124:** `combineByBuyer` was undefined. Added `const [combineByBuyer, setCombineByBuyer] = useState(false)` in `ToShipFlowView` and passed `combined: combineByBuyer` to the packing-slip API.

5. **`app/seller-hub/sponsor-hub/index.tsx`**
   - **Line 5:** `Redirect href="/seller-hub/business-hub"` was not in Expo Router’s typed routes. Used type assertion: `href={"/seller-hub/business-hub" as import("expo-router").Href}`.

6. **`app/seller-hub/store/returns/index.tsx`**
   - **Line 69:** `Alert` was used but not imported. Added `Alert` to the `react-native` import.

---

## Main App (Website) Lint Warnings

`pnpm run check` runs `next lint` for `apps/main`. No **errors** were reported; only **warnings**. Summary:

### 1. `@next/next/no-img-element`

Many files use `<img>` instead of Next.js `<Image />`. This can affect LCP and bandwidth. Consider migrating to `next/image` where appropriate (especially above-the-fold or large images).

**Representative files:**  
`about/page.tsx`, `cart/page.tsx`, `community-groups/**`, `my-community/**`, `resale/**`, `seller-hub/**`, `storefront/**`, `Header.tsx`, `MemberProfile.tsx`, `RewardsContent.tsx`, `StoreItemForm.tsx`, `SideCart.tsx`, and others.

### 2. `react-hooks/exhaustive-deps`

Some `useEffect` dependency arrays are incomplete or use complex expressions:

- `cart/page.tsx` (114): missing `refresh`
- `my-community/groups/page.tsx` (41): missing `loadGroups`
- `storefront/order-success/page.tsx` (60): missing `allOrderIds`; complex expression in deps
- `storefront/[slug]/page.tsx` (183): missing `item`
- `CalendarView.tsx` (55): missing `from`/`to`; complex expressions in deps
- `CreatePostForm.tsx` (70): missing `groupId`
- `NWCRequestsModal.tsx` (26): missing `session.user`
- `SideCart.tsx` (48): missing `refresh`
- `StoreItemForm.tsx` (177): missing `useSellerProfilePickup` / `useSellerProfileShipping`

Consider adding the suggested deps or wrapping callbacks in `useCallback` to avoid unnecessary re-runs, and extracting complex values to named variables before putting them in dependency arrays.

### 3. `jsx-a11y/role-has-required-aria-props`

- **`ThemeSelect.tsx` (70):** Elements with `role="option"` should define `aria-selected`. Add `aria-selected={isSelected}` (or equivalent) for accessibility.

---

## Recommendations

1. **CI:** Run `pnpm run check` in CI (or at least `tsc --noEmit` and `next lint` for `main`, and `tsc --noEmit` for `admin` and `mobile`) so regressions are caught before merge.
2. **Lint:** Gradually address `react-hooks/exhaustive-deps` and `no-img-element` (e.g. by file or by directory) and fix or disable with a short comment where intentional.
3. **A11y:** Fix `ThemeSelect` `aria-selected` and consider auditing other custom listbox/option patterns.
4. **Routes:** If you add more seller-hub (or other) routes, ensure Expo Router’s generated types include them, or use the same `Href` assertion pattern for redirects to untyped paths.

---

## How to Re-run

- **Full check (all packages, including main build):**  
  `pnpm run check`

- **TypeScript only (no build):**  
  - `pnpm --filter database check`  
  - `pnpm --filter types check`  
  - `pnpm --filter design-tokens check`  
  - `pnpm --filter main exec tsc --noEmit`  
  - `pnpm --filter admin exec tsc --noEmit`  
  - `pnpm --filter mobile exec tsc --noEmit`

- **Lint (main only):**  
  `pnpm --filter main lint`
