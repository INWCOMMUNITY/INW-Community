import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { z } from "zod";
import type { CalendarType } from "database";
import { requireAdmin } from "@/lib/admin-auth";

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
  description: z.string().nullable().optional(),
  calendarType: z.enum(calendarTypes as unknown as [string, ...string[]]),
  photos: z.array(z.string()).optional(),
  status: z.enum(["pending", "approved"]).optional(),
});

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export async function POST(req: NextRequest) {
  if (!requireAdmin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
        calendarType: data.calendarType as CalendarType,
        title: data.title,
        date,
        time: data.time ?? null,
        endTime: data.endTime ?? null,
        location: data.location ?? null,
        description: data.description ?? null,
        slug,
        photos: data.photos ?? [],
        status: data.status ?? "approved",
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
