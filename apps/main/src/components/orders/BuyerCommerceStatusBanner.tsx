import { IonIcon } from "@/components/IonIcon";
import type { BuyerCommerceStatus, BuyerCommerceStatusTone } from "@/lib/buyer-commerce-status";

const TONE: Record<BuyerCommerceStatusTone, { bg: string; fg: string }> = {
  pending: { bg: "var(--color-section-alt)", fg: "var(--color-earth)" },
  approved: { bg: "var(--color-section-alt)", fg: "var(--color-primary)" },
  moving: { bg: "var(--color-section-alt)", fg: "var(--color-earth)" },
  complete: { bg: "var(--color-section-alt)", fg: "var(--color-primary)" },
  declined: { bg: "#f4efe8", fg: "var(--color-earth)" },
};

export function BuyerCommerceStatusBanner({
  status,
  className = "",
}: {
  status: BuyerCommerceStatus;
  className?: string;
}) {
  const tone = TONE[status.tone];
  return (
    <div
      className={`flex items-start gap-3 rounded-xl px-3 py-2.5 ${className}`}
      style={{ backgroundColor: tone.bg, color: tone.fg }}
    >
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/80">
        <IonIcon name={status.icon} size={18} />
      </span>
      <div className="min-w-0 pt-0.5">
        <p className="text-sm font-semibold leading-tight">{status.title}</p>
        <p className="mt-0.5 text-sm leading-snug opacity-80">{status.detail}</p>
        {status.note ? <p className="mt-1 text-xs leading-snug opacity-70">{status.note}</p> : null}
      </div>
    </div>
  );
}
