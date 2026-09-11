/**
 * Restore connections paused by a local ENCRYPTION_KEY decrypt against hosted tokens.
 * Does not decrypt tokens. Run from apps/main: npx tsx scripts/debug-restore-decrypt-pause.ts
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

const LOG_PATH = path.resolve(process.cwd(), "../../debug-8e1c2a.log");
const INGEST = "http://127.0.0.1:7258/ingest/d5ed32a3-508e-4e39-8711-9dcd44c7de36";
const DECRYPT_RE = /encryption key cannot decrypt|could not be decrypted|platform encryption/i;

function dbg(message: string, data: Record<string, unknown>) {
  const payload = {
    sessionId: "8e1c2a",
    runId: "post-fix",
    hypothesisId: "F",
    location: "debug-restore-decrypt-pause.ts",
    message,
    data,
    timestamp: Date.now(),
  };
  // #region agent log
  fetch(INGEST, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "8e1c2a" },
    body: JSON.stringify(payload),
  }).catch(() => {});
  try {
    fs.appendFileSync(LOG_PATH, JSON.stringify(payload) + "\n");
  } catch {
    /* ignore */
  }
  // #endregion
  console.log(JSON.stringify({ message, data }, null, 2));
}

function pauseReasonOf(config: unknown): string | null {
  if (!config || typeof config !== "object" || Array.isArray(config)) return null;
  const v = (config as Record<string, unknown>).pauseReason;
  return typeof v === "string" ? v : null;
}

async function main() {
  const { prisma } = await import("database");
  const rows = await prisma.channelConnection.findMany({
    select: {
      id: true,
      provider: true,
      status: true,
      lastError: true,
      config: true,
    },
  });
  const affected = rows.filter((r) => {
    const reason = pauseReasonOf(r.config);
    return (
      reason === "decrypt_failure" ||
      (typeof r.lastError === "string" && DECRYPT_RE.test(r.lastError))
    );
  });
  dbg("connections matching decrypt pause", {
    total: rows.length,
    affected: affected.map((r) => ({
      provider: r.provider,
      status: r.status,
      pauseReason: pauseReasonOf(r.config),
      lastErrorPrefix: r.lastError?.slice(0, 80) ?? null,
    })),
  });

  for (const row of affected) {
    const config =
      row.config && typeof row.config === "object" && !Array.isArray(row.config)
        ? { ...(row.config as Record<string, unknown>) }
        : {};
    config.pauseReason = null;
    config.recoverAttempts = 0;
    config.nextRecoverAt = null;
    await prisma.channelConnection.update({
      where: { id: row.id },
      data: {
        status: "active",
        lastError: null,
        config: config as never,
      },
    });
  }

  dbg("restored decrypt-paused connections", {
    restored: affected.map((r) => r.provider),
    count: affected.length,
  });
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
