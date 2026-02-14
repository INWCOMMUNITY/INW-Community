import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
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
    await prisma.event.create({
      data: {
        memberId: session.user.id,
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
        status: "pending",
      },
    });
    const { awardCommunityPlannerBadge } = await import("@/lib/badge-award");
    awardCommunityPlannerBadge(session.user.id).catch(() => {});
    return NextResponse.json({ ok: true });
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
      include: { business: { select: { name: true, slug: true } } },
    });
    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }
    return NextResponse.json(event);
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
  return NextResponse.json(events);
}
