import { prisma } from "database";
import { AdminEventActions } from "./AdminEventActions";
import { AdminEventsAddButton } from "./AdminEventsAddButton";

const CALENDAR_LABELS: Record<string, string> = {
  fun_events: "Fun Events",
  local_art_music: "Local Art & Music",
  non_profit: "Non-Profit",
  business_promotional: "Business Promotional",
  marketing: "Marketing",
  real_estate: "Real Estate",
};

export default async function AdminEventsPage() {
  const events = await prisma.event.findMany({
    orderBy: { date: "asc" },
    include: { business: { select: { name: true } } },
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Events</h1>
        <AdminEventsAddButton />
      </div>
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Title</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Calendar</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Location</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {events.map((e) => (
              <tr key={e.id}>
                <td className="px-4 py-2 font-medium">{e.title}</td>
                <td className="px-4 py-2">{CALENDAR_LABELS[e.calendarType] ?? e.calendarType}</td>
                <td className="px-4 py-2">{new Date(e.date).toLocaleDateString()}</td>
                <td className="px-4 py-2">{e.location ?? "—"}</td>
                <td className="px-4 py-2">
                  <span
                    className={`text-xs font-medium px-2 py-0.5 rounded ${
                      e.status === "pending" ? "bg-amber-100 text-amber-800" : "bg-green-100 text-green-800"
                    }`}
                  >
                    {e.status}
                  </span>
                </td>
                <td className="px-4 py-2">
                  <AdminEventActions eventId={e.id} status={e.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
