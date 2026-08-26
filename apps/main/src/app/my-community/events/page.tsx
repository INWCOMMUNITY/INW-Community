import { Suspense } from "react";
import { getServerSession } from "next-auth";
import { prisma } from "database";
import { authOptions } from "@/lib/auth";
import { BackToProfileLink } from "@/components/BackToProfileLink";
import { MyEventsContent } from "@/components/event/MyEventsContent";
import { getEventInviteStatsByEventIds } from "@/lib/event-invite-stats";
import { toMyEventListItem } from "@/lib/my-events-page";

const EVENT_SELECT = {
  id: true,
  title: true,
  slug: true,
  date: true,
  time: true,
  endTime: true,
  location: true,
  city: true,
  description: true,
  photos: true,
  calendarType: true,
  business: { select: { name: true, slug: true } },
} as const;

export default async function MyEventsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return null;
  const userId = session.user.id;

  const [savedRows, rsvpRows, postedRows] = await Promise.all([
    prisma.savedItem.findMany({
      where: { memberId: userId, type: "event" },
      orderBy: { createdAt: "desc" },
      select: { referenceId: true },
    }),
    prisma.eventInvite.findMany({
      where: {
        inviteeId: userId,
        status: { in: ["accepted", "maybe"] },
      },
      include: { event: { select: { ...EVENT_SELECT, status: true } } },
      orderBy: { event: { date: "asc" } },
    }),
    prisma.event.findMany({
      where: {
        status: "approved",
        OR: [{ memberId: userId }, { business: { memberId: userId } }],
      },
      select: EVENT_SELECT,
      orderBy: { date: "desc" },
    }),
  ]);

  const savedIds = savedRows.map((s) => s.referenceId);
  const savedEvents = savedIds.length
    ? await prisma.event.findMany({
        where: { id: { in: savedIds }, status: "approved" },
        select: EVENT_SELECT,
      })
    : [];
  const savedMap = new Map(savedEvents.map((e) => [e.id, e]));
  const saved = savedIds
    .map((id) => savedMap.get(id))
    .filter((e): e is NonNullable<typeof e> => e != null)
    .map((e) => toMyEventListItem(e));

  const going = rsvpRows
    .filter((row) => row.event.status === "approved")
    .map((row) => toMyEventListItem(row.event, { rsvpStatus: row.status }));

  const statsMap = await getEventInviteStatsByEventIds(postedRows.map((e) => e.id));
  const posted = postedRows.map((e) => {
    const stats = statsMap.get(e.id);
    const hasActivity =
      stats != null && (stats.sent > 0 || stats.attending > 0 || stats.maybe > 0 || stats.declined > 0);
    return toMyEventListItem(e, hasActivity ? { inviteStats: stats } : undefined);
  });

  return (
    <>
      <BackToProfileLink />
      <Suspense fallback={<p className="text-gray-500">Loading events…</p>}>
        <MyEventsContent saved={saved} going={going} posted={posted} />
      </Suspense>
    </>
  );
}
