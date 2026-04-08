import { prisma } from "database";

type PostAuthRow = {
  authorId: string;
  sourceBusinessId: string | null;
  sourceCouponId: string | null;
  sourceRewardId: string | null;
  sourcePostId: string | null;
  groupId: string | null;
};

/** Author may always delete. Business owner may delete posts that promote their listing/coupon/reward (including nested reshares). */
export async function canMemberDeletePost(memberId: string, postId: string): Promise<boolean> {
  const visited = new Set<string>();
  let currentId: string | null = postId;

  while (currentId) {
    if (visited.has(currentId)) return false;
    visited.add(currentId);

    const row: PostAuthRow | null = await prisma.post.findUnique({
      where: { id: currentId },
      select: {
        authorId: true,
        sourceBusinessId: true,
        sourceCouponId: true,
        sourceRewardId: true,
        sourcePostId: true,
        groupId: true,
      },
    });
    if (!row) return false;

    if (await postRowAllowsDelete(memberId, row)) return true;

    currentId = row.sourcePostId;
  }

  return false;
}

async function postRowAllowsDelete(memberId: string, post: PostAuthRow): Promise<boolean> {
  if (post.authorId === memberId) return true;

  if (post.sourceBusinessId) {
    const b = await prisma.business.findUnique({
      where: { id: post.sourceBusinessId },
      select: { memberId: true },
    });
    if (b?.memberId === memberId) return true;
  }
  if (post.sourceCouponId) {
    const c = await prisma.coupon.findUnique({
      where: { id: post.sourceCouponId },
      select: { business: { select: { memberId: true } } },
    });
    if (c?.business.memberId === memberId) return true;
  }
  if (post.sourceRewardId) {
    const r = await prisma.reward.findUnique({
      where: { id: post.sourceRewardId },
      select: { business: { select: { memberId: true } } },
    });
    if (r?.business.memberId === memberId) return true;
  }
  if (post.groupId) {
    const group = await prisma.group.findUnique({
      where: { id: post.groupId },
      select: { createdById: true },
    });
    const membership = await prisma.groupMember.findUnique({
      where: {
        groupId_memberId: { groupId: post.groupId, memberId },
      },
      select: { role: true },
    });
    if (group && (group.createdById === memberId || membership?.role === "admin")) {
      return true;
    }
  }
  return false;
}
