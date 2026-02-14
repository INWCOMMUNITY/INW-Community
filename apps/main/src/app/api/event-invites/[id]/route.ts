import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getSessionForApi } from "@/lib/mobile-auth";
import { z } from "zod";

const bodySchema = z.object({
  status: z.enum(["accepted", "declined", "maybe"]),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session =
    (await getSessionForApi(req)) ?? (await getServerSession(authOptions));
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: inviteId } = await params;
  const invite = await prisma.eventInvite.findUnique({
    where: { id: inviteId },
    select: { id: true, inviteeId: true, status: true },
  });

  if (!invite) {
    return NextResponse.json({ error: "Invitation not found" }, { status: 404 });
  }

  if (invite.inviteeId !== session.user.id) {
    return NextResponse.json({ error: "You can only respond to your own invitations" }, { status: 403 });
  }

  if (invite.status !== "pending") {
    return NextResponse.json({ error: "Invitation already responded to" }, { status: 400 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: e.flatten() }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  await prisma.eventInvite.update({
    where: { id: inviteId },
    data: { status: body.status },
  });

  return NextResponse.json({ ok: true, status: body.status });
}
