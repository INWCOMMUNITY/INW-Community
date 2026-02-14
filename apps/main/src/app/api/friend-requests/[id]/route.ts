import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";

const bodySchema = z.object({
  status: z.enum(["accepted", "declined"]),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const friendReq = await prisma.friendRequest.findUnique({
    where: { id },
  });
  if (!friendReq) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (friendReq.addresseeId !== session.user.id) {
    return NextResponse.json({ error: "Can only accept/decline requests sent to you" }, { status: 403 });
  }
  if (friendReq.status !== "pending") {
    return NextResponse.json({ error: "Request already processed" }, { status: 400 });
  }

  try {
    const body = await req.json();
    const { status } = bodySchema.parse(body);
    await prisma.friendRequest.update({
      where: { id },
      data: { status },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: e.flatten() }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
