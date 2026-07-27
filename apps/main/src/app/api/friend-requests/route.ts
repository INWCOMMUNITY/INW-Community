import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { requireVerifiedActiveMember } from "@/lib/require-verified-member";
import { hasBlockBetween } from "@/lib/member-block";
import { z } from "zod";

const DAILY_FRIEND_REQUEST_LIMIT = 50;

const bodySchema = z.object({
  addresseeId: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const verified = await requireVerifiedActiveMember(session.user.id);
  if (!verified.ok) return verified.response;

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

    // Block check: prevent friend requests between blocked users
    if (await hasBlockBetween(session.user.id, addresseeId)) {
      return NextResponse.json({ error: "Cannot send request to this member" }, { status: 403 });
    }

    // Rate limit: max 50 friend requests per day
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dailyCount = await prisma.friendRequest.count({
      where: {
        requesterId: session.user.id,
        createdAt: { gte: today },
      },
    });
    if (dailyCount >= DAILY_FRIEND_REQUEST_LIMIT) {
      return NextResponse.json(
        { error: "You've sent too many friend requests today. Try again tomorrow." },
        { status: 429 }
      );
    }

    // Check for declined request cooldown (7 days)
    const recentDeclined = await prisma.friendRequest.findFirst({
      where: {
        requesterId: session.user.id,
        addresseeId,
        status: "declined",
        updatedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      },
    });
    if (recentDeclined) {
      return NextResponse.json(
        { error: "This request was recently declined. Please wait before trying again." },
        { status: 400 }
      );
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

    const sender = await prisma.member.findUnique({
      where: { id: session.user.id },
      select: { firstName: true, lastName: true },
    });
    const senderName =
      (session.user as { name?: string }).name ??
      (sender ? [sender.firstName, sender.lastName].filter(Boolean).join(" ") : null);
    const { sendPushNotification } = await import("@/lib/send-push-notification");
    sendPushNotification(addresseeId, {
      title: "You have a new Friend Request!",
      body: senderName ? `${senderName} wants to connect — tap to respond!` : "Someone wants to connect — tap to respond!",
      // Open Friend Requests (stack with native back) instead of requester profile — avoids empty back stack from cold start.
      data: { screen: "friend_requests", memberId: session.user.id },
      category: "social",
    }).catch(() => {});

    return NextResponse.json(req_);
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: e.flatten() }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const verified = await requireVerifiedActiveMember(session.user.id);
  if (!verified.ok) return verified.response;

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
