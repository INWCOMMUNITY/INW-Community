/** Action-required indicator on hub tiles (matches NWC theme). */
export function HubExclamationBadge({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span
      className="absolute top-2 right-2 z-10 flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold text-white shadow-sm"
      style={{ backgroundColor: "var(--color-primary)" }}
      aria-hidden
    >
      !
    </span>
  );
}
