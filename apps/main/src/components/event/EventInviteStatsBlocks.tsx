import type { EventInviteStats } from "@/lib/event-invite-stats";

const ROW = [
  { key: "sent" as const, label: "Invites" },
  { key: "attending" as const, label: "Going" },
  { key: "maybe" as const, label: "Maybe" },
  { key: "declined" as const, label: "Can't go" },
];

export function EventInviteStatsBlocks({ stats }: { stats: EventInviteStats }) {
  return (
    <div className="grid grid-cols-4 gap-1 mt-1.5 w-full">
      {ROW.map(({ key, label }) => (
        <div
          key={key}
          className="aspect-square max-h-[3.5rem] rounded-lg flex flex-col items-center justify-center px-0.5 py-1"
          style={{ backgroundColor: "#FDEDCC" }}
          aria-label={`${label}: ${stats[key]}`}
        >
          <span
            className="text-sm sm:text-base font-bold leading-none"
            style={{ color: "var(--color-heading)" }}
          >
            {stats[key]}
          </span>
          <span className="text-[9px] sm:text-[10px] font-semibold text-center leading-tight text-[#5a6570] mt-0.5">
            {label}
          </span>
        </div>
      ))}
    </div>
  );
}
