import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { z } from "zod";

const patchSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  pointsRequired: z.number().int().min(1).optional(),
  redemptionLimit: z.number().int().min(1).optional(),
  cashValueCents: z.number().int().min(0).nullable().optional(),
  imageUrl: z.string().url().nullable().optional().or(z.literal("")),
  needsShipping: z.boolean().optional(),
  status: z.enum(["active", "inactive"]).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  try {
    const reward = await prisma.reward.findUnique({
      where: { id },
      include: { business: { select: { memberId: true } } },
    });
    if (!reward || reward.business.memberId !== session.user.id) {
      return NextResponse.json({ error: "Not found or not yours" }, { status: 403 });
    }

    const body = await req.json();
    const data = patchSchema.parse(body);

    await prisma.reward.update({
      where: { id },
      data: {
        ...(data.title !== undefined && { title: data.title }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.pointsRequired !== undefined && { pointsRequired: data.pointsRequired }),
        ...(data.redemptionLimit !== undefined && { redemptionLimit: data.redemptionLimit }),
        ...(data.cashValueCents !== undefined && { cashValueCents: data.cashValueCents }),
        ...(data.imageUrl !== undefined && { imageUrl: data.imageUrl || null }),
        ...(data.needsShipping !== undefined && { needsShipping: data.needsShipping === true }),
        ...(data.status !== undefined && { status: data.status }),
      },
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: e.flatten() }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

/** Soft-delete reward (keeps redemptions intact). */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  const reward = await prisma.reward.findUnique({
    where: { id },
    include: { business: { select: { memberId: true } } },
  });
  if (!reward || reward.business.memberId !== session.user.id) {
    return NextResponse.json({ error: "Not found or not yours" }, { status: 403 });
  }

  await prisma.reward.update({ where: { id }, data: { status: "inactive" } });
  return NextResponse.json({ ok: true });
}

