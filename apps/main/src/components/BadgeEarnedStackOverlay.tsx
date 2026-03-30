"use client";

import { BadgeIcon } from "@/lib/badge-icons";

export type EarnedBadgeForOverlay = { slug: string; name: string; description?: string };

type BadgeEarnedStackOverlayProps = {
  badge: EarnedBadgeForOverlay | null;
  /** Tailwind z-index class for stacking above page chrome */
  zIndexClass?: string;
  onDismiss: () => void;
};

export function BadgeEarnedStackOverlay({
  badge,
  zIndexClass = "z-[250]",
  onDismiss,
}: BadgeEarnedStackOverlayProps) {
  if (!badge) return null;

  return (
    <div
      className={`fixed inset-0 ${zIndexClass} flex items-center justify-center p-4 bg-black/60`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="badge-earned-stack-title"
    >
      <div className="relative w-full max-w-sm rounded-2xl border-[3px] border-[var(--color-primary)] bg-white p-7 shadow-xl text-center">
        <button
          type="button"
          onClick={onDismiss}
          className="absolute top-3 right-3 p-1 rounded text-gray-500 hover:bg-gray-100"
          aria-label="Close"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
            <path
              fillRule="evenodd"
              d="M5.47 5.47a.75.75 0 011.06 0L12 10.94l5.47-5.47a.75.75 0 111.06 1.06L13.06 12l5.47 5.47a.75.75 0 11-1.06 1.06L12 13.06l-5.47 5.47a.75.75 0 01-1.06-1.06L10.94 12 5.47 6.53a.75.75 0 010-1.06z"
              clipRule="evenodd"
            />
          </svg>
        </button>
        <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
          <BadgeIcon slug={badge.slug} size={48} />
        </div>
        <p className="text-xl font-bold text-[var(--color-heading,#333)]">Congrats!</p>
        <h3 id="badge-earned-stack-title" className="mt-1 text-lg font-semibold text-[var(--color-primary)]">
          You earned &quot;{badge.name}&quot;!
        </h3>
        {badge.description ? (
          <p className="mt-3 text-sm text-gray-600 leading-relaxed">{badge.description}</p>
        ) : null}
        <button type="button" onClick={onDismiss} className="btn mt-6 w-full">
          Awesome!
        </button>
      </div>
    </div>
  );
}
