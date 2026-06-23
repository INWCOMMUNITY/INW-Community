import { prisma } from "database";
import { resolveCanonicalPostId } from "@/lib/resolve-canonical-post-id";

export type ContentShareChannel =
  | "feed_reshare"
  | "group_reshare"
  | "dm"
  | "email"
  | "sms"
  | "link_copy"
  | "external";

export type RecordContentShareInput = {
  memberId: string;
  contentType: "post";
  contentId: string;
  channel: ContentShareChannel;
};

function utcShareDay(date = new Date()): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function getPrismaErrorCode(e: unknown): string | undefined {
  if (e != null && typeof e === "object" && "code" in e) {
    return (e as { code?: string }).code;
  }
  return undefined;
}

function isMissingShareEventTable(e: unknown): boolean {
  const code = getPrismaErrorCode(e);
  return code === "P2021" || /content_share_event/i.test(String(e));
}

/** Stale Next/webpack bundles can lack the delegate until `prisma generate` + server restart. */
function shareEventDelegateAvailable(): boolean {
  const delegate = (prisma as { contentShareEvent?: { groupBy?: unknown; create?: unknown } })
    .contentShareEvent;
  return delegate != null && typeof delegate.groupBy === "function";
}

/** Legacy feed/group reshare counts from shared_post rows. */
export async function countLegacyFeedReshares(
  canonicalPostIds: string[]
): Promise<Record<string, number>> {
  const unique = [...new Set(canonicalPostIds.filter(Boolean))];
  if (unique.length === 0) return {};

  const rows = await prisma.post.groupBy({
    by: ["sourcePostId"],
    where: {
      sourcePostId: { in: unique },
      type: "shared_post",
    },
    _count: { _all: true },
  });

  const map: Record<string, number> = {};
  for (const row of rows) {
    if (row.sourcePostId) {
      map[row.sourcePostId] = row._count._all;
    }
  }
  return map;
}

/** Count share events per canonical post id. Falls back to legacy reshares if table missing. */
export async function countPostShares(postIds: string[]): Promise<Record<string, number>> {
  const unique = [...new Set(postIds.filter(Boolean))];
  if (unique.length === 0) return {};

  if (!shareEventDelegateAvailable()) {
    return countLegacyFeedReshares(unique);
  }

  try {
    const rows = await prisma.contentShareEvent.groupBy({
      by: ["contentId"],
      where: {
        contentType: "post",
        contentId: { in: unique },
      },
      _count: { _all: true },
    });
    return Object.fromEntries(rows.map((r) => [r.contentId, r._count._all]));
  } catch (e) {
    if (isMissingShareEventTable(e)) {
      console.warn("[countPostShares] content_share_event table missing — falling back to legacy counts");
      return countLegacyFeedReshares(unique);
    }
    throw e;
  }
}

export async function recordContentShare(
  input: RecordContentShareInput
): Promise<{ recorded: boolean; shareCount: number }> {
  const canonicalId =
    input.contentType === "post"
      ? await resolveCanonicalPostId(input.contentId)
      : input.contentId;

  const shareDay = utcShareDay();

  let eventInserted = false;

  if (!shareEventDelegateAvailable()) {
    console.warn(
      "[recordContentShare] Prisma client missing contentShareEvent delegate — run `pnpm --filter database generate` and restart"
    );
  } else {
    try {
      await prisma.contentShareEvent.create({
        data: {
          memberId: input.memberId,
          contentType: input.contentType,
          contentId: canonicalId,
          channel: input.channel,
          shareDay,
        },
      });
      eventInserted = true;
    } catch (e) {
      if (getPrismaErrorCode(e) === "P2002") {
        // Daily dedupe — share already tracked today for this channel
      } else if (isMissingShareEventTable(e)) {
        console.warn("[recordContentShare] content_share_event table missing — using legacy counts");
      } else {
        console.error("[recordContentShare] failed:", e);
      }
    }
  }

  const shareCount = await getMergedShareCount(canonicalId);
  return { recorded: true, shareCount: eventInserted ? shareCount : shareCount + 1 };
}

/** Event count merged with legacy reshares (max avoids double-count after backfill). */
async function getMergedShareCount(canonicalId: string): Promise<number> {
  const [events, legacy] = await Promise.all([
    countPostShares([canonicalId]),
    countLegacyFeedReshares([canonicalId]),
  ]);
  return Math.max(events[canonicalId] ?? 0, legacy[canonicalId] ?? 0);
}
