import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import {
  getEventInviteStatsByEventIds,
  isEventOwner,
} from "@/lib/event-invite-stats";
import { validateText } from "@/lib/content-moderation";
import { containsProhibitedCategory } from "@/lib/content-moderation";
import { createFlaggedContent } from "@/lib/flag-content";
import { z } from "zod";
import type { CalendarType } from "database";
import { requireVerifiedActiveMember } from "@/lib/require-verified-member";

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
  /** When posting on behalf of a business; must be owned by the authenticated member. */
  businessId: z.string().min(1).optional(),
});

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const verified = await requireVerifiedActiveMember(session.user.id);
  if (!verified.ok) return verified.response;
  try {
    const body = await req.json();
    const data = bodySchema.parse(body);
    const date = new Date(data.date);
    if (isNaN(date.getTime())) {
      return NextResponse.json({ error: "Invalid date" }, { status: 400 });
    }
    let slug = slugify(data.title);
    let suffix = 0;
    while (await prisma.event.findUnique({ where: { slug } })) {
      slug = `${slugify(data.title)}-${++suffix}`;
    }

    // Auto-approve; flag if restricted content detected
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

    let businessId: string | null = null;
    if (data.businessId) {
      const owned = await prisma.business.findFirst({
        where: { id: data.businessId, memberId: session.user.id },
        select: { id: true },
      });
      if (!owned) {
        return NextResponse.json({ error: "Invalid business" }, { status: 400 });
      }
      businessId = owned.id;
    }

    // All events are saved unless explicitly deleted (admin delete or flagged content removed).
    const event = await prisma.event.create({
      data: {
        memberId: session.user.id,
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
        contentId: event.id,
        reason: flagReason,
        snippet: [data.title, desc].filter(Boolean).join(" ").slice(0, 500),
        authorId: session.user.id,
      });
    }
    const { awardCommunityPlannerBadge } = await import("@/lib/badge-award");
    let earnedBadges: { slug: string; name: string; description: string }[] = [];
    try {
      earnedBadges = await awardCommunityPlannerBadge(session.user.id);
    } catch {
      /* best-effort */
    }
    return NextResponse.json({ ok: true, earnedBadges });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: e.flatten() }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

function isCuid(s: string): boolean {
  return /^c[a-z0-9]{24}$/i.test(s);
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const slug = searchParams.get("slug");

  if (slug) {
    const event = await prisma.event.findFirst({
      where: {
        status: "approved",
        ...(isCuid(slug) ? { id: slug } : { slug }),
      },
      include: { business: { select: { name: true, slug: true, memberId: true } } },
    });
    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }
    const session = await getSessionForApi(req);
    if (session?.user?.id && isEventOwner(event, session.user.id)) {
      const statsMap = await getEventInviteStatsByEventIds([event.id]);
      return NextResponse.json({
        ...event,
        inviteStats: statsMap.get(event.id)!,
      });
    }
    const { business, ...rest } = event;
    const businessPublic = business
      ? { name: business.name, slug: business.slug }
      : null;
    return NextResponse.json({ ...rest, business: businessPublic });
  }

  const calendarType = searchParams.get("calendarType") as CalendarType | null;
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const city = searchParams.get("city");
  const validType = calendarType && calendarTypes.includes(calendarType);
  const events = await prisma.event.findMany({
    where: {
      status: "approved",
      ...(validType ? { calendarType } : {}),
      ...(city && city !== "All cities" ? { city } : {}),
      ...(from && to
        ? {
            date: {
              gte: new Date(from),
              lte: new Date(to),
            },
          }
        : {}),
    },
    include: {
      business: { select: { name: true, slug: true } },
    },
    orderBy: { date: "asc" },
  });
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json(events);
  }
  const myBusinessIds = new Set(
    (
      await prisma.business.findMany({
        where: { memberId: session.user.id },
        select: { id: true },
      })
    ).map((b) => b.id)
  );
  const ownedIds = events
    .filter(
      (e) =>
        e.memberId === session.user.id ||
        (!!e.businessId && myBusinessIds.has(e.businessId))
    )
    .map((e) => e.id);
  if (ownedIds.length === 0) {
    return NextResponse.json(events);
  }
  const statsMap = await getEventInviteStatsByEventIds(ownedIds);
  const ownedSet = new Set(ownedIds);
  const withStats = events.map((e) =>
    ownedSet.has(e.id)
      ? { ...e, inviteStats: statsMap.get(e.id)! }
      : e
  );
  return NextResponse.json(withStats);
}
