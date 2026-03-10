import { prisma } from "database";

function isMemberBlockTableError(e: unknown): boolean {
  const err = e as { code?: string; message?: string };
  if (err?.code === "P2021") return true; // table does not exist
  const msg = err?.message ?? (e instanceof Error ? e.message : String(e));
  return (
    typeof msg === "string" &&
    msg.includes("member_block") &&
    (msg.includes("does not exist") || msg.includes("does no"))
  );
}

/**
 * Returns the set of member IDs blocked by the given user.
 * If the member_block table does not exist (migration not run), returns an empty set.
 */
export async function getBlockedMemberIds(blockerId: string): Promise<Set<string>> {
  try {
    const blocks = await prisma.memberBlock.findMany({
      where: { blockerId },
      select: { blockedId: true },
    });
    return new Set(blocks.map((b) => b.blockedId));
  } catch (e) {
    if (isMemberBlockTableError(e)) return new Set();
    throw e;
  }
}

/**
 * Returns true if blockerId has blocked blockedId.
 * If the member_block table does not exist (migration not run), returns false.
 */
export async function isBlocked(blockerId: string, blockedId: string): Promise<boolean> {
  try {
    const block = await prisma.memberBlock.findUnique({
      where: {
        blockerId_blockedId: { blockerId, blockedId },
      },
    });
    return block != null;
  } catch (e) {
    if (isMemberBlockTableError(e)) return false;
    throw e;
  }
}
