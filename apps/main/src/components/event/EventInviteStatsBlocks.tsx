import type { EventInviteStats } from "@/lib/event-invite-stats";

const ROW = [
  { key: "sent" as const, label: "Invites" },
  { key: "attending" as const, label: "Going" },
  { key: "maybe" as const, label: "Maybe" },
  { key: "declined" as const, label: "Can't go" },
];

export function EventInviteStatsBlocks({ stats }: { stats: EventInviteStats }) {
  return (
    <div className="mx-auto flex w-full max-w-md gap-1.5">
      {ROW.map(({ key, label }) => (
        <div
          key={key}
          className="flex min-w-0 flex-1 flex-col items-center justify-center aspect-square max-h-[4.5rem] rounded-lg px-1 py-2 text-center"
          style={{ backgroundColor: "#FDEDCC" }}
          aria-label={`${label}: ${stats[key]}`}
        >
          <span
            className="text-base font-bold leading-none"
            style={{ color: "var(--color-heading)" }}
          >
            {stats[key]}
          </span>
          <span className="mt-1 text-[10px] font-semibold leading-tight text-[#5a6570]">
            {label}
          </span>
        </div>
      ))}
    </div>
  );
}
