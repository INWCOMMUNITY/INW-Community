/**
 * Read-only: eBay webhook receipt + connection status. Does not refresh tokens.
 * Run from apps/main: npx tsx scripts/debug-ebay-inbound-probe.ts
 */
import fs from "fs";
import path from "path";

function loadEnvFile(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf8");
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] == null || process.env[key] === "") process.env[key] = value;
  }
}

loadEnvFile(path.resolve(process.cwd(), "../../.env"));
loadEnvFile(path.resolve(process.cwd(), "../../.env.local"));
loadEnvFile(path.resolve(process.cwd(), ".env"));
loadEnvFile(path.resolve(process.cwd(), ".env.local"));

const INGEST = "http://127.0.0.1:7258/ingest/d5ed32a3-508e-4e39-8711-9dcd44c7de36";

function dbg(hypothesisId: string, location: string, message: string, data: Record<string, unknown>) {
  // #region agent log
  fetch(INGEST, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "f3d848" },
    body: JSON.stringify({
      sessionId: "f3d848",
      hypothesisId,
      location,
      message,
      data,
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
}

async function main() {
  const { prisma } = await import("database");
  const { readEbayWebhookReceipt } = await import("../src/lib/channels/ebay/notifications-setup");

  const conn = await prisma.channelConnection.findFirst({
    where: { provider: "ebay" },
    orderBy: { updatedAt: "desc" },
  });
  if (!conn) {
    dbg("B", "debug-ebay-inbound-probe.ts:nocon", "no ebay connection row", {});
    console.log(JSON.stringify({ error: "no ebay connection row" }, null, 2));
    await prisma.$disconnect();
    return;
  }

  const cfg =
    conn.config && typeof conn.config === "object" && !Array.isArray(conn.config)
      ? (conn.config as Record<string, unknown>)
      : {};
  const receipt = readEbayWebhookReceipt(conn.config);
  const storedUrl =
    typeof cfg.notificationsWebhookUrl === "string" ? cfg.notificationsWebhookUrl : null;
  let storedHost: string | null = null;
  let storedPath: string | null = null;
  let storedHasSecretQuery = false;
  if (storedUrl) {
    try {
      const u = new URL(storedUrl);
      storedHost = u.host;
      storedPath = u.pathname;
      storedHasSecretQuery = u.searchParams.has("secret");
    } catch {
      storedHasSecretQuery = /[?&]secret=/i.test(storedUrl);
    }
  }

  const commerceIds = Array.isArray(cfg.commerceNotificationSubscriptionIds)
    ? cfg.commerceNotificationSubscriptionIds.filter((id): id is string => typeof id === "string")
    : [];
  const tokenExpiresAt = conn.tokenExpiresAt?.toISOString() ?? null;
  const tokenExpired =
    conn.tokenExpiresAt != null && conn.tokenExpiresAt.getTime() - 5 * 60 * 1000 < Date.now();

  let livePrefs: Record<string, unknown> | null = null;
  let livePrefsError: string | null = null;
  if (!conn.accessTokenEncrypted) {
    livePrefsError = "no-access-token";
  } else if (tokenExpired) {
    livePrefsError = "token-expired-skipped-refresh";
  } else {
    try {
      const { decrypt } = await import("../src/lib/encrypt");
      const { getEbayNotificationPreferences } = await import(
        "../src/lib/channels/ebay/trading"
      );
      const { redactEbayWebhookUrl } = await import("../src/lib/channels/ebay/webhook");
      const accessToken = decrypt(conn.accessTokenEncrypted);
      const live = await getEbayNotificationPreferences(accessToken);
      livePrefs = {
        fetched: live.fetched,
        subscribed: live.subscribed,
        urlSecured: live.urlSecured ?? null,
        events: live.events ?? [],
        liveHost: live.webhookUrl
          ? (() => {
              try {
                return new URL(live.webhookUrl).host;
              } catch {
                return null;
              }
            })()
          : null,
        livePath: live.webhookUrl
          ? (() => {
              try {
                return new URL(live.webhookUrl).pathname;
              } catch {
                return null;
              }
            })()
          : null,
        liveHasSecretQuery: live.webhookUrl
          ? /[?&]secret=/i.test(live.webhookUrl)
          : false,
        liveUrlRedacted: live.webhookUrl ? redactEbayWebhookUrl(live.webhookUrl) : null,
      };
    } catch (e) {
      livePrefsError = e instanceof Error ? e.message : String(e);
    }
  }

  const payload = {
    lastEbayWebhookAt: receipt.lastEbayWebhookAt,
    lastEbayWebhookEvent: receipt.lastEbayWebhookEvent,
    lastEbayWebhookHitAt: receipt.lastEbayWebhookHitAt,
    lastEbayWebhookHitReason: receipt.lastEbayWebhookHitReason,
    storedHost,
    storedPath,
    storedHasSecretQuery,
    notificationsEnabled: cfg.notificationsEnabled === true,
    notificationsEnabledAt: typeof cfg.notificationsEnabledAt === "string" ? cfg.notificationsEnabledAt : null,
    notificationsError: typeof cfg.notificationsError === "string" ? cfg.notificationsError : null,
    commerceDestinationId: typeof cfg.commerceNotificationsDestinationId === "string"
      ? cfg.commerceNotificationsDestinationId
      : null,
    commerceSubscriptionCount: commerceIds.length,
    lastCommerceNotificationsError:
      typeof cfg.lastCommerceNotificationsError === "string"
        ? cfg.lastCommerceNotificationsError
        : null,
    connectionStatus: conn.status,
    lastError: conn.lastError,
    lastReconciledAt: conn.lastReconciledAt?.toISOString() ?? null,
    tokenExpiresAt,
    tokenExpired,
    livePrefs,
    livePrefsError,
  };
  dbg("H2", "debug-ebay-inbound-probe.ts:receipt", "connection + webhook stamps + live prefs", {
    ...payload,
    connectionId: conn.id,
    hasLastError: Boolean(conn.lastError),
    hypothesisId: "H2",
  });
  console.log(JSON.stringify(payload, null, 2));
  await prisma.$disconnect();
}

main().catch((e) => {
  dbg("G", "debug-ebay-inbound-probe.ts:fatal", "probe threw", {
    error: e instanceof Error ? e.message : String(e),
  });
  console.error(e);
  process.exit(1);
});
