import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { prisma } from "database";
import Link from "next/link";
import { HeartSaveButton } from "@/components/HeartSaveButton";
import { BusinessPhotoGallery } from "@/components/BusinessPhotoGallery";
import { InviteFriendsToEvent } from "@/components/InviteFriendsToEvent";
import { authOptions } from "@/lib/auth";
import { formatTime12h } from "@/lib/format-time";

function isCuid(s: string): boolean {
  return /^c[a-z0-9]{24}$/i.test(s);
}

export default async function EventDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const event = await prisma.event.findFirst({
    where: isCuid(slug) ? { id: slug } : { slug },
    include: { business: { select: { name: true, slug: true } } },
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

  const dateStr = new Date(event.date).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  return (
    <section className="py-12 px-4" style={{ padding: "var(--section-padding)" }}>
      <div className="max-w-[var(--max-width)] mx-auto">
        <Link href="/calendars" className="text-sm text-gray-600 hover:underline mb-4 inline-block">
          ← Back to Calendars
        </Link>
        <h1 className="text-3xl font-bold mb-2">{event.title}</h1>
        <p className="text-gray-600 mb-2">
          {dateStr}
          {event.time
            ? event.endTime
              ? ` · ${formatTime12h(event.time)} – ${formatTime12h(event.endTime)}`
              : ` · ${formatTime12h(event.time)}`
            : ""}
        </p>
        {event.location && <p className="text-gray-600 mb-2">Location: {event.location}</p>}
        {event.business && (
          <Link href={`/support-local/${event.business.slug}`} className="hover:underline mb-4 inline-block" style={{ color: "var(--color-link)" }}>
            {event.business.name}
          </Link>
        )}
        {event.description && <p className="mb-4 whitespace-pre-wrap">{event.description}</p>}
        {event.photos && event.photos.length > 0 && (
          <div className="mt-6">
            <h2 className="text-xl font-semibold mb-3">Event photos</h2>
            <BusinessPhotoGallery photos={event.photos} alt="Event photo" size="large" />
          </div>
        )}
        <HeartSaveButton type="event" referenceId={event.id} initialSaved={!!saved} />
        {session?.user?.id && event.memberId === session.user.id && (
          <InviteFriendsToEvent eventId={event.id} />
        )}
      </div>
    </section>
  );
}
