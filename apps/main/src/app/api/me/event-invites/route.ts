import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getSessionForApi } from "@/lib/mobile-auth";

export async function GET(req: NextRequest) {
  const session =
    (await getSessionForApi(req)) ?? (await getServerSession(authOptions));
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const invites = await prisma.eventInvite.findMany({
    where: {
      inviteeId: session.user.id,
      status: "pending",
    },
    include: {
      event: {
        select: {
          id: true,
          title: true,
          slug: true,
          date: true,
          time: true,
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

  return NextResponse.json({
    invites: invites.map((inv) => ({
      id: inv.id,
      event: inv.event,
      inviter: inv.inviter,
      createdAt: inv.createdAt,
    })),
  });
}
