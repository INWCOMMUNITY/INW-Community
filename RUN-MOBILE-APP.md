# Run the Mobile App

Connect the app to your computer's live server when both are on the same network.

## Quick checklist

1. **Backend** – `pnpm dev:main` (runs on port 3000, bound to all interfaces)
2. **API URL** – `apps/mobile/.env` has `EXPO_PUBLIC_API_URL=http://YOUR_IP:3000`
3. **Seed data** – `pnpm db:seed` once for test accounts, businesses, events
4. **App** – `pnpm dev:app`

---

## 1. Get your computer's IP

In PowerShell:

```powershell
ipconfig
```

Find **IPv4 Address** under your active adapter (e.g. `192.168.1.140`). Use this for a **physical device**.  
For **Android emulator** use `10.0.2.2` instead.

## 2. Set EXPO_PUBLIC_API_URL in apps/mobile/.env

```
EXPO_PUBLIC_API_URL=http://YOUR_IP:3000
```

Example: `EXPO_PUBLIC_API_URL=http://192.168.1.140:3000`

Restart Expo after changing `.env` — env vars load at startup.

## 3. Run the servers (separate terminals)

**Terminal 1 — Backend (API for store, businesses, events, auth):**

```powershell
cd "c:\dev\INW Community"
pnpm dev:main
```

Wait until you see "Ready". The server runs at `http://localhost:3000` and is reachable from your network.

**Terminal 2 — Mobile app:**

```powershell
cd "c:\dev\INW Community"
pnpm dev:app
```

- Press **a** for Android  
- Press **i** for iOS  
- Or scan the QR code with Expo Go

## 4. Test profile sign-in

- **Profile tab** → Sign in
- **Email:** subscriber@nwc.local
- **Password:** Subscriber123!

Other test accounts (run `pnpm db:seed` first):

| Account            | Email                 | Password   |
|--------------------|-----------------------|------------|
| **Universal** (all roles) | universal@nwc.local | Universal123! |
| Subscriber         | subscriber@nwc.local   | Subscriber123! |
| Sponsor            | sponsor@nwc.local      | Sponsor123! |
| Seller             | seller@nwc.local       | Seller123! |

## 5. One-time setup (if needed)

```powershell
pnpm install
pnpm db:generate
pnpm db:push
pnpm db:seed
```

---

## Connection test (phone can't reach server)

1. **Get your IP**: `ipconfig` → find IPv4 (e.g. `192.168.1.140`)
2. **Start server**: `pnpm dev:main` (wait for "Ready")
3. **On your phone's browser**, open: `http://YOUR_IP:3000/api/ping`
   - See `{"ok":true}` → connection works; problem is elsewhere
   - Timeout or error → firewall/network blocking; try USB (see below) or different WiFi

## Troubleshooting

| Issue | Fix |
|------|-----|
| **"Request timed out"** or **"Cannot reach server"** | **Windows Firewall** blocks incoming connections. Right‑click `FIREWALL-ALLOW-3000.cmd` → Run as administrator. Or: Windows Security → Firewall → Allow an app → find Node.js → check Private. Restart the app and try again. |
| **"Could not connect to development server"** | 1) Same Wi‑Fi for phone and computer. 2) Try tunnel mode: `pnpm --filter mobile start:tunnel` (slower but works across networks/firewalls). 3) Windows Firewall: run `FIREWALL-ALLOW-3000.cmd` as admin. 4) Restart Expo and reload the app. |
| Store, businesses, events empty / not loading | Confirm `pnpm dev:main` is running and `EXPO_PUBLIC_API_URL` matches your IP. Same Wi‑Fi for device. |
| Sign-in fails / "Cannot reach server" | Same checks as above. Restart Expo after changing `.env`. |
| Android emulator can't connect | Use `EXPO_PUBLIC_API_URL=http://10.0.2.2:3000` in `apps/mobile/.env`. |
| "Invalid credentials" for test account | Run `pnpm db:seed` from the project root. |
| Port 3000 in use (dev:main fails) | `netstat -ano \| findstr :3000` then `taskkill /PID <number> /F` to free it. |
