# Mobile App – Live Site Integration

The mobile app is configured to connect to the live site at **https://inw-community.vercel.app**.

## Configuration

| File | Variable | Value |
|------|----------|-------|
| `apps/mobile/.env` | `EXPO_PUBLIC_API_URL` | `https://inw-community.vercel.app` |
| `apps/mobile/.env` | `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Matches main app (live key) |

## Testing the App Against the Live Site

1. **Ensure you have the right env** – `apps/mobile/.env` should have:
   ```
   EXPO_PUBLIC_API_URL=https://inw-community.vercel.app
   EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...
   ```

2. **Start the mobile app only** (no need to run the backend locally):
   ```powershell
   cd "c:\dev\INW Community"
   pnpm dev:app
   ```

3. **Run on device or simulator:**
   - Press **a** for Android emulator
   - Press **i** for iOS simulator
   - Or scan the QR code with **Expo Go** on your phone

4. **Sign in** – Use an account that exists on the live site. The app will authenticate against the production API.

## Switching Between Local and Live

- **Live site:** `EXPO_PUBLIC_API_URL=https://inw-community.vercel.app` (current)
- **Local dev:** Change to `EXPO_PUBLIC_API_URL=http://YOUR_IP:3000` and run `pnpm dev:main` in a separate terminal

Restart Expo after changing `.env` – env vars load at startup.
