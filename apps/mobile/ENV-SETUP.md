# Mobile app env (Mac / iOS)

The app uses **EXPO_PUBLIC_*** variables (baked in at build time). No `.env` is committed; you set env per machine or in EAS.

## Option A: Local file (for `npx expo start` or local build)

1. In the repo root (or `apps/mobile`) create or edit `.env` so Expo can load it (Expo loads `.env` from the project root when you run from there).

2. From **monorepo root** (`c:\dev\INW Community`), create **`apps/mobile/.env`** with:

   ```env
   # Point to your backend (live site for iOS rebuild / TestFlight)
   EXPO_PUBLIC_API_URL="https://www.inwcommunity.com"

   # Stripe (for in-app checkout) – use same publishable key as main site
   EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY="pk_live_..."
   ```

   For **local dev** (phone hitting your Mac), use your Mac’s IP instead:

   ```env
   EXPO_PUBLIC_API_URL="http://192.168.1.XXX:3000"
   ```

3. **Restart Expo** after changing `.env` (env is read at start). For a **new iOS build** (e.g. `eas build --platform ios`), run the build from the repo root so the env is picked up; or use Option B.

## Option B: EAS (cloud build / TestFlight)

For **EAS Build** (Expo Application Services), env is **not** read from your local `.env`. Set it in:

- **EAS Dashboard** → your project → **Environment variables**, or  
- **eas.json** under `build.env` (avoid secrets in plain text; use EAS secrets).

Add at least:

- `EXPO_PUBLIC_API_URL` = `https://www.inwcommunity.com`
- `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` = your `pk_live_...` (same as main site)

Then run your iOS build; the new build will use those values.

## Summary

| Goal              | Where to set env                          |
|-------------------|--------------------------------------------|
| Local dev on Mac  | `apps/mobile/.env` or root `.env`, restart Expo |
| iOS rebuild (EAS) | EAS Dashboard → Environment variables      |
| Production API    | `EXPO_PUBLIC_API_URL=https://www.inwcommunity.com` |

**Do not commit `.env`** — it’s in `.gitignore`. Each developer / machine sets their own.
