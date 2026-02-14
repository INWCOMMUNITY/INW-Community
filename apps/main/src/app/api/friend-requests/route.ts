import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";

const bodySchema = z.object({
  addresseeId: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { addresseeId } = bodySchema.parse(body);

    if (addresseeId === session.user.id) {
      return NextResponse.json({ error: "Cannot send request to yourself" }, { status: 400 });
    }

    const addressee = await prisma.member.findUnique({
      where: { id: addresseeId },
      select: { id: true, privacyLevel: true },
    });
    if (!addressee) return NextResponse.json({ error: "Member not found" }, { status: 404 });
    if (addressee.privacyLevel === "completely_private") {
      return NextResponse.json({ error: "Cannot send request to this member" }, { status: 403 });
    }

    const existing = await prisma.friendRequest.findFirst({
      where: {
        OR: [
          { requesterId: session.user.id, addresseeId },
          { requesterId: addresseeId, addresseeId: session.user.id },
        ],
      },
    });
    if (existing) {
      if (existing.status === "accepted") {
        return NextResponse.json({ error: "Already friends" }, { status: 400 });
      }
      if (existing.requesterId === session.user.id) {
        return NextResponse.json({ error: "Request already sent" }, { status: 400 });
      }
      return NextResponse.json({ error: "They have already sent you a request" }, { status: 400 });
    }

    const req_ = await prisma.friendRequest.create({
      data: {
        requesterId: session.user.id,
        addresseeId,
        status: "pending",
      },
    });
    return NextResponse.json(req_);
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: e.flatten() }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const incoming = await prisma.friendRequest.findMany({
    where: { addresseeId: session.user.id, status: "pending" },
    include: {
      requester: { select: { id: true, firstName: true, lastName: true, profilePhotoUrl: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  const outgoing = await prisma.friendRequest.findMany({
    where: { requesterId: session.user.id, status: "pending" },
    include: {
      addressee: { select: { id: true, firstName: true, lastName: true, profilePhotoUrl: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  const friends = await prisma.friendRequest.findMany({
    where: {
      OR: [
        { requesterId: session.user.id, status: "accepted" },
        { addresseeId: session.user.id, status: "accepted" },
      ],
    },
    include: {
      requester: { select: { id: true, firstName: true, lastName: true, profilePhotoUrl: true } },
      addressee: { select: { id: true, firstName: true, lastName: true, profilePhotoUrl: true } },
    },
  });
  const friendList = friends.map((f) =>
    f.requesterId === session.user!.id ? f.addressee : f.requester
  );

  return NextResponse.json({
    incoming,
    outgoing,
    friends: friendList,
  });
}
