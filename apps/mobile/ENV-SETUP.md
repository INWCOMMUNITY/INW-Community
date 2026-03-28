# Mobile app env (local dev, Mac / Windows, Expo Go)

The app uses **EXPO_PUBLIC_*** variables (baked in at build time). No `.env` is committed; you set env per machine or in EAS.

## Local API + Expo Go

1. Start the Next.js app from the **monorepo root**: `pnpm dev:main` (serves on port **3000**, bound to **0.0.0.0** so LAN devices can connect).

2. In **`apps/mobile/.env`**, set `EXPO_PUBLIC_API_URL`:

   - **Physical phone (Expo Go):** `http://YOUR_COMPUTER_LAN_IP:3000` — not `localhost` (on the phone, localhost is the phone).
   - **iOS Simulator:** `http://127.0.0.1:3000`
   - **Android emulator:** `http://10.0.2.2:3000`

   **Windows:** list IPv4 addresses: `Get-NetIPAddress -AddressFamily IPv4` (pick your Wi‑Fi / Ethernet address, same subnet as the phone).

3. Phone and computer must be on the **same Wi‑Fi** (or allow the port through the firewall).

4. **Restart Expo** after changing `.env` (`pnpm dev:app` from repo root, or `pnpm --filter mobile start`).

5. Optional: set `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` to match `apps/main` (e.g. `pk_test_...`) if you exercise checkout locally.

## Option A: Local file (for `npx expo start` or local build)

1. Create or edit **`apps/mobile/.env`** (Expo loads `.env` from the app directory when you run the mobile package).

2. Example for **production API** (TestFlight / live backend):

   ```env
   EXPO_PUBLIC_API_URL="https://www.inwcommunity.com"
   EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY="pk_live_..."
   ```

3. For a **new iOS build** (e.g. `eas build --platform ios`), run the build from the repo root so the env is picked up; or use Option B.

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
