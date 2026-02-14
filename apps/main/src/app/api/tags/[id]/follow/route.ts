import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";

const bodySchema = z.object({
  action: z.enum(["follow", "unfollow"]),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const tag = await prisma.tag.findUnique({ where: { id } });
  if (!tag) {
    return NextResponse.json({ error: "Tag not found" }, { status: 404 });
  }

  try {
    const body = await req.json();
    const { action } = bodySchema.parse(body);

    const existing = await prisma.followTag.findUnique({
      where: {
        memberId_tagId: { memberId: session.user.id, tagId: id },
      },
    });

    if (action === "follow") {
      if (existing) {
        return NextResponse.json({ following: true });
      }
      await prisma.followTag.create({
        data: { memberId: session.user.id, tagId: id },
      });
      return NextResponse.json({ following: true });
    } else {
      if (existing) {
        await prisma.followTag.delete({ where: { id: existing.id } });
      }
      return NextResponse.json({ following: false });
    }
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: e.flatten() }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
