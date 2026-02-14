import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";

export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const accepted = await prisma.friendRequest.findMany({
    where: {
      status: "accepted",
      OR: [
        { requesterId: session.user.id },
        { addresseeId: session.user.id },
      ],
    },
    include: {
      requester: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          profilePhotoUrl: true,
          city: true,
        },
      },
      addressee: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          profilePhotoUrl: true,
          city: true,
        },
      },
    },
  });

  const friends = accepted.map((fr) => {
    const other = fr.requesterId === session.user.id ? fr.addressee : fr.requester;
    return {
      id: other.id,
      firstName: other.firstName,
      lastName: other.lastName,
      profilePhotoUrl: other.profilePhotoUrl,
      city: other.city,
    };
  });

  return NextResponse.json({ friends });
}
