import { prisma } from "database";

export function isCuid(s: string): boolean {
  return /^c[a-z0-9]{24}$/i.test(s);
}

export type GroupAdminContext =
  | { ok: true; group: { id: string; slug: string; name: string; createdById: string }; isCreator: boolean }
  | { ok: false; status: number; error: string };

export async function getGroupAdminContext(
  slugOrId: string,
  userId: string | undefined
): Promise<GroupAdminContext> {
  if (!userId) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  const group = await prisma.group.findFirst({
    where: isCuid(slugOrId) ? { id: slugOrId } : { slug: slugOrId },
    select: { id: true, slug: true, name: true, createdById: true },
  });
  if (!group) {
    return { ok: false, status: 404, error: "Group not found" };
  }
  const membership = await prisma.groupMember.findUnique({
    where: {
      groupId_memberId: { groupId: group.id, memberId: userId },
    },
  });
  const isAdmin = group.createdById === userId || membership?.role === "admin";
  if (!isAdmin) {
    return { ok: false, status: 403, error: "Only group admins can access this" };
  }
  return {
    ok: true,
    group,
    isCreator: group.createdById === userId,
  };
}
