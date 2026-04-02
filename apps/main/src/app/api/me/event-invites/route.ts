import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getSessionForApi } from "@/lib/mobile-auth";
import { eventInviteEventHasPassed } from "@/lib/event-invite-visible";

export async function GET(req: NextRequest) {
  const session =
    (await getSessionForApi(req)) ?? (await getServerSession(authOptions));
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const scope = new URL(req.url).searchParams.get("scope") ?? "all";
  const whereStatus =
    scope === "pending"
      ? { status: "pending" as const }
      : scope === "responded"
        ? { status: { in: ["accepted", "declined", "maybe"] } }
        : {};

  const invites = await prisma.eventInvite.findMany({
    where: {
      inviteeId: session.user.id,
      ...whereStatus,
    },
    include: {
      event: {
        select: {
          id: true,
          title: true,
          slug: true,
          date: true,
          time: true,
          endTime: true,
          location: true,
        },
      },
      inviter: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          profilePhotoUrl: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const visible = invites.filter(
    (inv) => !eventInviteEventHasPassed(inv.event)
  );

  return NextResponse.json({
    invites: visible.map((inv) => ({
      id: inv.id,
      status: inv.status,
      event: inv.event,
      inviter: inv.inviter,
      createdAt: inv.createdAt,
    })),
  });
}
