import { prisma } from "database";
import { z } from "zod";

export const groupCreationPayloadSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(2000).optional(),
  category: z.string().max(50).optional(),
  coverImageUrl: z
    .string()
    .refine((v) => !v || v.startsWith("/") || v.startsWith("http"), "Invalid cover image URL")
    .optional()
    .nullable(),
  rules: z.string().max(5000).optional().nullable(),
  allowBusinessPosts: z.boolean().optional(),
});

export type GroupCreationPayload = z.infer<typeof groupCreationPayloadSchema>;

export function slugifyGroupName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Creates a Group and admin GroupMember for the given member. Used after admin approval or direct admin action.
 */
export async function createGroupForMember(
  requesterMemberId: string,
  data: GroupCreationPayload
): Promise<{
  group: { id: string; slug: string; name: string };
  earnedBadges: { slug: string; name: string; description: string }[];
}> {
  let slug = slugifyGroupName(data.name);
  let suffix = 0;
  while (await prisma.group.findUnique({ where: { slug } })) {
    slug = `${slugifyGroupName(data.name)}-${++suffix}`;
  }

  const group = await prisma.group.create({
    data: {
      name: data.name,
      description: data.description ?? null,
      category: data.category ?? null,
      coverImageUrl: data.coverImageUrl ?? null,
      rules: data.rules ?? null,
      allowBusinessPosts: data.allowBusinessPosts ?? false,
      slug,
      createdById: requesterMemberId,
    },
  });

  await prisma.groupMember.create({
    data: {
      groupId: group.id,
      memberId: requesterMemberId,
      role: "admin",
    },
  });

  const { awardAdminBadge } = await import("@/lib/badge-award");
  let earnedBadges: { slug: string; name: string; description: string }[] = [];
  try {
    earnedBadges = await awardAdminBadge(requesterMemberId);
  } catch {
    /* best-effort */
  }

  return {
    group: { id: group.id, slug: group.slug, name: group.name },
    earnedBadges: Array.isArray(earnedBadges) ? earnedBadges : [],
  };
}
