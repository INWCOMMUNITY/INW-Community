import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { requireVerifiedActiveMember } from "@/lib/require-verified-member";
import { eventInviteEventHasPassed } from "@/lib/event-invite-visible";
import { z } from "zod";

const bodySchema = z.object({
  status: z.enum(["accepted", "declined", "maybe"]),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const verified = await requireVerifiedActiveMember(session.user.id);
  if (!verified.ok) return verified.response;

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: e.flatten() }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { id: eventId } = await params;
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: {
      id: true,
      status: true,
      date: true,
      time: true,
      endTime: true,
    },
  });

  if (!event || event.status !== "approved") {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  if (eventInviteEventHasPassed(event)) {
    return NextResponse.json({ error: "This event has ended" }, { status: 400 });
  }

  const userId = session.user.id;
  const existing = await prisma.eventInvite.findUnique({
    where: {
      eventId_inviteeId: {
        eventId,
        inviteeId: userId,
      },
    },
    select: { id: true },
  });

  if (existing) {
    await prisma.eventInvite.update({
      where: { id: existing.id },
      data: { status: body.status },
    });
  } else {
    await prisma.eventInvite.create({
      data: {
        eventId,
        inviterId: userId,
        inviteeId: userId,
        status: body.status,
      },
    });
  }

  return NextResponse.json({ ok: true, status: body.status });
}
