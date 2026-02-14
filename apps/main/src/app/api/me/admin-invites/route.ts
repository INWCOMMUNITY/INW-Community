import { NextResponse } from "next/server";
import { prisma } from "database";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const invites = await prisma.groupAdminInvite.findMany({
    where: { inviteeId: session.user.id, status: "pending" },
    include: {
      group: { select: { id: true, name: true, slug: true } },
      inviter: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  return NextResponse.json({ invites });
}
