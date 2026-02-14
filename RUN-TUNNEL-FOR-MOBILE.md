# Use Tunnel When Phone Can't Reach Local API

If "Request timed out" persists after firewall rules, your router may block device-to-device traffic. A tunnel exposes your API to the internet so the phone connects via the tunnel instead of your local network.

## Option A: localtunnel (no signup)

1. **Ensure `pnpm dev:main` is running** (port 3000).

2. **In a new terminal**, run:
   ```powershell
   npx localtunnel --port 3000
   ```

3. You'll see output like:
   ```
   your url is: https://random-words-123.loca.lt
   ```

4. **Update `apps/mobile/.env`** – set:
   ```
   EXPO_PUBLIC_API_URL=https://random-words-123.loca.lt
   ```
   (Use the exact URL from step 3. Add `?bypass=true` if prompted for a password: `https://random-words-123.loca.lt?bypass=true`)

5. **Restart Expo** (Ctrl+C, then `pnpm dev:app`). Reload the app on your phone.

---

## Option B: ngrok (more reliable, free signup)

1. Sign up at [ngrok.com](https://ngrok.com) (free).

2. Install and configure:
   ```powershell
   npm install -g ngrok
   ngrok config add-authtoken YOUR_TOKEN_FROM_DASHBOARD
   ```

3. **Ensure `pnpm dev:main` is running.**

4. **In a new terminal**, run:
   ```powershell
   ngrok http 3000
   ```

5. Copy the HTTPS URL (e.g. `https://abc123.ngrok-free.app`).

6. **Update `apps/mobile/.env`**:
   ```
   EXPO_PUBLIC_API_URL=https://abc123.ngrok-free.app
   ```

7. **Restart Expo** and reload the app.

---

## Option C: Android + USB (ADB reverse)

If you use **Android** and connect the phone via **USB**:

1. Enable Developer Options and USB debugging on the phone.

2. Connect the phone with USB, then run:
   ```powershell
   adb reverse tcp:3000 tcp:3000
   ```

3. **Update `apps/mobile/.env`**:
   ```
   EXPO_PUBLIC_API_URL=http://localhost:3000
   ```

4. **Restart Expo** and reload the app. API calls go through USB to your computer.
