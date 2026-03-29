# NWC realtime (Socket.IO)

Long-running service for live direct, group, and resale messaging. The main Next.js app **publishes** events via `POST /internal/publish` after database writes; clients connect with a JWT and **join** per-thread rooms.

## Environment

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` or `REALTIME_PORT` | No | Listen port (default **3007**) |
| `NEXTAUTH_SECRET` | Yes | Same secret as main app (JWT verification) |
| `REALTIME_PUBLISH_SECRET` | Yes | Bearer token for `/internal/publish` (match main `REALTIME_PUBLISH_SECRET`) |
| `DATABASE_URL` | Yes | Same Postgres/Neon URL as main (for join authorization) |
| `REDIS_URL` | No | If set, enables `@socket.io/redis-adapter` for **multiple** realtime instances |
| `REALTIME_CORS_ORIGINS` | No | Comma-separated allowed browser origins |
| `REALTIME_METRICS_SECRET` | No | If set, `/internal/metrics` requires `Authorization: Bearer <secret>` |

## Public URL (production)

Deploy this app to a host with a **stable HTTPS** endpoint (e.g. `wss://realtime.yourdomain.com`). Set on **Vercel / main app**:

- `REALTIME_PUBLISH_URL` = `https://realtime.yourdomain.com` (no trailing slash)
- `NEXT_PUBLIC_REALTIME_URL` = same origin as clients use for Socket.IO

Set **`EXPO_PUBLIC_REALTIME_URL`** in mobile release builds to that same WebSocket-capable URL.

## Health & metrics

- `GET /health` — JSON `{ ok, uptimeSec }`
- `GET /internal/metrics` — connection count, publish count, typing throttle count (protect with `REALTIME_METRICS_SECRET` in production)

## Docker (from repo root)

```bash
docker build -f apps/realtime/Dockerfile -t nwc-realtime .
docker run --env-file .env -p 3007:3007 nwc-realtime
```

Ensure `.env` includes `NEXTAUTH_SECRET`, `REALTIME_PUBLISH_SECRET`, `DATABASE_URL`, and optional `REDIS_URL`.

## Fly.io (example)

Build context must be the **repository root** (Dockerfile copies `pnpm-workspace.yaml` and `packages/database`).

1. Install [flyctl](https://fly.io/docs/hands-on/install-flyctl/), run `fly auth login`.
2. From repo root: `fly launch` and point the Dockerfile to `apps/realtime/Dockerfile`, or:  
   `fly deploy --dockerfile apps/realtime/Dockerfile` (after `fly.toml` exists for the app).
3. Set secrets: `fly secrets set NEXTAUTH_SECRET=... REALTIME_PUBLISH_SECRET=... DATABASE_URL=...`
4. Optional: `fly secrets set REDIS_URL=...` (e.g. Upstash Redis).

## Local dev

From repo root:

```bash
pnpm dev:realtime
```

Main app `.env`: `REALTIME_PUBLISH_URL=http://127.0.0.1:3007` and `REALTIME_PUBLISH_SECRET=...`.

### Mobile / web: `connect_error invalid token`

JWTs for Socket.IO are verified with `NEXTAUTH_SECRET`. That value must match the secret used by the Next.js app that issued the mobile Bearer token. In local dev, `pnpm dev:realtime` loads `NEXTAUTH_SECRET` from the monorepo root `.env` and, when present, from `apps/main/.env` and `apps/main/.env.local` (same order as Next). If you still see this error, confirm there is only one secret in play (no stale shell `export`) and restart both `dev:main` and `dev:realtime`.

### Website: no live messages / typing / presence

1. **Vercel:** Set `NEXT_PUBLIC_REALTIME_URL` (and publish vars) and **redeploy** so the client bundle includes the URL.
2. Open the site, go to Messages, open DevTools **Console**. Look for `[messages realtime]` warnings (missing URL, token 401, etc.).
3. **CORS:** Production allows `*.inwcommunity.com`, `*.northwestcommunity.com`, and `https://*.vercel.app`. Any other origin must be listed in `REALTIME_CORS_ORIGINS` on the realtime service (comma-separated).
4. **HTTPS:** The page must use `https://` if the realtime URL is `https://` (mixed content blocks `ws:` from secure pages).
5. **Socket.IO URL:** Use `https://…` in env (not `wss://`; the client normalizes either). No trailing slash.
