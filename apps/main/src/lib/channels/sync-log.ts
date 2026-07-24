import { prisma } from "database";

export type SyncLogAction =
  | "push_inventory"
  | "push_content"
  | "pull_catalog"
  | "sale_applied"
  | "conflict_resolved"
  | "token_refreshed"
  | "token_expired"
  | "import"
  | "error"
  | "error_permanent"
  | "retry_exhausted"
  | "circuit_open"
  | "circuit_closed";

/**
 * Fire-and-forget insert into ChannelSyncLog. Never throws — sync operations
 * must not fail because of a logging issue.
 */
export function logSyncEvent(
  memberId: string,
  provider: string,
  action: SyncLogAction,
  detail?: string | null,
  storeItemId?: string | null
): void {
  prisma.channelSyncLog
    .create({
      data: {
        memberId,
        provider,
        action,
        detail: detail?.slice(0, 1000) ?? null,
        storeItemId: storeItemId ?? null,
      },
    })
    .catch((e) => {
      console.warn("[sync-log] failed to write", { error: String(e).slice(0, 200) });
    });
}
