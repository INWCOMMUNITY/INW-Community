import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-auth";

const prizeSchema = z.object({
  rank: z.number().int().min(1).max(5),
  label: z.string(),
  imageUrl: z.string().url().nullable().optional().or(z.literal("")),
  businessId: z.string().nullable().optional(),
});
const patchSchema = z.object({
  enabled: z.boolean().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  prizes: z.array(prizeSchema).optional(),
});

export async function GET(req: NextRequest) {
  if (!requireAdmin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const campaign = await prisma.top5Campaign.findFirst({
    orderBy: { updatedAt: "desc" },
  });
  if (!campaign) {
    return NextResponse.json({
      enabled: false,
      startDate: new Date().toISOString().slice(0, 10),
      endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      prizes: [
        { rank: 1, label: "", imageUrl: null, businessId: null },
        { rank: 2, label: "", imageUrl: null, businessId: null },
        { rank: 3, label: "", imageUrl: null, businessId: null },
        { rank: 4, label: "", imageUrl: null, businessId: null },
        { rank: 5, label: "", imageUrl: null, businessId: null },
      ],
    });
  }
  const prizes = (campaign.prizes as { rank: number; label: string; imageUrl?: string; businessId?: string }[]) ?? [];
  const defaultPrizes = [1, 2, 3, 4, 5].map((rank) => {
    const existing = prizes.find((p) => p.rank === rank);
    return existing ?? { rank, label: "", imageUrl: null, businessId: null };
  });
  return NextResponse.json({
    enabled: campaign.enabled,
    startDate: campaign.startDate.toISOString().slice(0, 10),
    endDate: campaign.endDate.toISOString().slice(0, 10),
    prizes: defaultPrizes,
  });
}

export async function PATCH(req: NextRequest) {
  if (!requireAdmin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await req.json();
    const data = patchSchema.parse(body);
    const startDate = data.startDate ? new Date(data.startDate) : new Date();
    const endDate = data.endDate ? new Date(data.endDate) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const prizes = data.prizes ?? [
      { rank: 1, label: "", imageUrl: null, businessId: null },
      { rank: 2, label: "", imageUrl: null, businessId: null },
      { rank: 3, label: "", imageUrl: null, businessId: null },
      { rank: 4, label: "", imageUrl: null, businessId: null },
      { rank: 5, label: "", imageUrl: null, businessId: null },
    ];
    const existing = await prisma.top5Campaign.findFirst({ orderBy: { updatedAt: "desc" } });
    if (existing) {
      await prisma.top5Campaign.update({
        where: { id: existing.id },
        data: {
          ...(data.enabled !== undefined && { enabled: data.enabled }),
          ...(data.startDate !== undefined && { startDate }),
          ...(data.endDate !== undefined && { endDate }),
          ...(data.prizes !== undefined && { prizes }),
        },
      });
    } else {
      await prisma.top5Campaign.create({
        data: {
          enabled: data.enabled ?? false,
          startDate,
          endDate,
          prizes,
        },
      });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: e.flatten() }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
