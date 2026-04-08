import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { requireAdmin } from "@/lib/admin-auth";
import { createGroupForMember, groupCreationPayloadSchema } from "@/lib/create-group-core";
import { sendPushNotification } from "@/lib/send-push-notification";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdmin(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const adminEmail = process.env.ADMIN_EMAIL?.trim() ?? null;

  const row = await prisma.groupCreationRequest.findUnique({
    where: { id },
    include: { requester: { select: { email: true } } },
  });

  if (!row || row.status !== "pending") {
    return NextResponse.json({ error: "Request not found or already reviewed" }, { status: 404 });
  }

  const payload = groupCreationPayloadSchema.parse({
    name: row.name,
    description: row.description ?? undefined,
    category: row.category ?? undefined,
    coverImageUrl: row.coverImageUrl ?? undefined,
    rules: row.rules ?? undefined,
    allowBusinessPosts: row.allowBusinessPosts,
  });

  try {
    const { group, earnedBadges } = await createGroupForMember(row.requesterMemberId, payload);

    await prisma.groupCreationRequest.update({
      where: { id },
      data: {
        status: "approved",
        reviewedAt: new Date(),
        reviewedByAdminEmail: adminEmail,
        resultingGroupId: group.id,
      },
    });

    void sendPushNotification(row.requesterMemberId, {
      title: "Your group was approved",
      body: `“${group.name}” is live. Tap to open it.`,
      category: "group_admin",
      data: {
        screen: "group_feed",
        groupSlug: group.slug,
      },
    }).catch((err) => console.error("[admin approve group request] push", id, err));

    const full = await prisma.group.findUnique({ where: { id: group.id } });
    return NextResponse.json({ group: full, earnedBadges });
  } catch (e) {
    console.error("[admin approve group request]", id, e);
    return NextResponse.json({ error: "Failed to create group" }, { status: 500 });
  }
}
