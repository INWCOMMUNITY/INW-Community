import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { prisma } from "database";
import { EventDetailContent, type EventDetailData } from "@/components/event/EventDetailContent";
import { authOptions } from "@/lib/auth";
import {
  getEventInviteStatsByEventIds,
  isEventOwner,
} from "@/lib/event-invite-stats";

function isCuid(s: string): boolean {
  return /^c[a-z0-9]{24}$/i.test(s);
}

function formatEventDateForCalendar(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${day}`;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const event = await prisma.event.findFirst({
    where: {
      status: "approved",
      ...(isCuid(slug) ? { id: slug } : { slug }),
    },
    select: { title: true, photos: true },
  });
  if (!event) return { title: "Event" };
  const shareDescription = "Check out this event on INW Community!";
  const image = event.photos[0];
  return {
    title: event.title,
    description: shareDescription,
    openGraph: {
      title: event.title,
      description: shareDescription,
      ...(image ? { images: [{ url: image }] } : {}),
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title: event.title,
      description: shareDescription,
      ...(image ? { images: [image] } : {}),
    },
  };
}

export default async function EventDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const event = await prisma.event.findFirst({
    where: {
      status: "approved",
      ...(isCuid(slug) ? { id: slug } : { slug }),
    },
    include: {
      business: { select: { name: true, slug: true, memberId: true } },
    },
  });
  if (!event) notFound();

  const session = await getServerSession(authOptions);
  const saved = session?.user?.id
    ? await prisma.savedItem.findUnique({
        where: {
          memberId_type_referenceId: {
            memberId: session.user.id,
            type: "event",
            referenceId: event.id,
          },
        },
      })
    : null;

  let inviteStats = null;
  if (session?.user?.id && isEventOwner(event, session.user.id)) {
    const statsMap = await getEventInviteStatsByEventIds([event.id]);
    inviteStats = statsMap.get(event.id) ?? null;
  }

  const detail: EventDetailData = {
    id: event.id,
    slug: event.slug,
    title: event.title,
    date: formatEventDateForCalendar(event.date),
    time: event.time,
    endTime: event.endTime,
    location: event.location,
    city: event.city,
    description: event.description,
    photos: event.photos ?? [],
    business: event.business
      ? { name: event.business.name, slug: event.business.slug }
      : null,
    inviteStats,
  };

  return (
    <EventDetailContent
      event={detail}
      initialSaved={!!saved}
      backHref="/calendars"
    />
  );
}
