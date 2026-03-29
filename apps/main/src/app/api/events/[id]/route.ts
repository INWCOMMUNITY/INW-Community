import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { getEventInviteStatsByEventIds } from "@/lib/event-invite-stats";
import { validateText } from "@/lib/content-moderation";
import { containsProhibitedCategory } from "@/lib/content-moderation";
import { createFlaggedContent } from "@/lib/flag-content";
import { z } from "zod";
import type { CalendarType } from "database";

const calendarTypes: CalendarType[] = [
  "fun_events",
  "local_art_music",
  "non_profit",
  "business_promotional",
  "marketing",
  "real_estate",
];

const bodySchema = z.object({
  title: z.string().min(1),
  date: z.string(),
  time: z.string().nullable().optional(),
  endTime: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  calendarType: z.enum(calendarTypes as unknown as [string, ...string[]]),
  photos: z.array(z.string()).optional(),
  businessId: z.string().min(1).optional().nullable(),
});

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function uniqueSlugForTitle(title: string, excludeEventId: string): Promise<string> {
  let slug = slugify(title);
  let suffix = 0;
  for (;;) {
    const existing = await prisma.event.findUnique({ where: { slug } });
    if (!existing || existing.id === excludeEventId) break;
    slug = `${slugify(title)}-${++suffix}`;
  }
  return slug;
}

type EventForOwnerCheck = {
  memberId: string | null;
  businessId: string | null;
  business: { memberId: string } | null;
};

function isOwner(event: EventForOwnerCheck, userId: string): boolean {
  return (
    event.memberId === userId ||
    (event.businessId != null && event.business?.memberId === userId)
  );
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const event = await prisma.event.findUnique({
    where: { id },
    include: { business: { select: { memberId: true, name: true, slug: true } } },
  });
  if (!event || !isOwner(event, session.user.id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const statsMap = await getEventInviteStatsByEventIds([event.id]);
  return NextResponse.json({
    ...event,
    inviteStats: statsMap.get(event.id)!,
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const existing = await prisma.event.findUnique({
    where: { id },
    include: { business: { select: { memberId: true } } },
  });
  if (!existing || !isOwner(existing, session.user.id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const body = await req.json();
    const data = bodySchema.parse(body);
    const date = new Date(data.date);
    if (isNaN(date.getTime())) {
      return NextResponse.json({ error: "Invalid date" }, { status: 400 });
    }

    let businessId: string | null = existing.businessId;
    if (data.businessId !== undefined) {
      if (data.businessId === null || data.businessId === "") {
        businessId = null;
      } else {
        const owned = await prisma.business.findFirst({
          where: { id: data.businessId, memberId: session.user.id },
          select: { id: true },
        });
        if (!owned) {
          return NextResponse.json({ error: "Invalid business" }, { status: 400 });
        }
        businessId = owned.id;
      }
    }

    let shouldFlag = false;
    let flagReason: "slur" | "prohibited_category" | "profanity" | "restricted" = "restricted";
    const titleCheck = validateText(data.title, "comment");
    if (!titleCheck.allowed) {
      shouldFlag = true;
      flagReason = "slur";
    }
    const desc = data.description ?? "";
    if (desc && !validateText(desc, "comment").allowed) {
      shouldFlag = true;
      flagReason = "slur";
    }
    if (containsProhibitedCategory(data.title, null, desc)) {
      shouldFlag = true;
      flagReason = "prohibited_category";
    }

    const titleChanged = data.title.trim() !== existing.title;
    const slug = titleChanged ? await uniqueSlugForTitle(data.title, id) : existing.slug;

    await prisma.event.update({
      where: { id },
      data: {
        businessId,
        calendarType: data.calendarType as CalendarType,
        title: data.title,
        date,
        time: data.time ?? null,
        endTime: data.endTime ?? null,
        location: data.location ?? null,
        city: data.city ?? null,
        description: data.description ?? null,
        slug,
        photos: data.photos ?? [],
        status: "approved",
      },
    });

    if (shouldFlag) {
      await createFlaggedContent({
        contentType: "event",
        contentId: id,
        reason: flagReason,
        snippet: [data.title, desc].filter(Boolean).join(" ").slice(0, 500),
        authorId: session.user.id,
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

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const existing = await prisma.event.findUnique({
    where: { id },
    include: { business: { select: { memberId: true } } },
  });
  if (!existing || !isOwner(existing, session.user.id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.$transaction([
    prisma.savedItem.deleteMany({
      where: { type: "event", referenceId: id },
    }),
    prisma.event.delete({ where: { id } }),
  ]);

  return NextResponse.json({ ok: true });
}
