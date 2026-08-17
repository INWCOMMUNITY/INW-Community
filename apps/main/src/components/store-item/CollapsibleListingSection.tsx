"use client";

import { useState, type ReactNode } from "react";
import { IonIcon } from "@/components/IonIcon";

type CollapsibleListingSectionProps = {
  title: string;
  subtitle?: string;
  icon?: string;
  defaultExpanded?: boolean;
  children: ReactNode;
  badge?: string;
  badgeColor?: string;
};

export function CollapsibleListingSection({
  title,
  subtitle,
  icon,
  defaultExpanded = false,
  children,
  badge,
  badgeColor = "#6b7280",
}: CollapsibleListingSectionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <section className="rounded-xl border border-gray-200 bg-gray-50 overflow-hidden shadow-sm">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left hover:bg-gray-100/80 transition-colors"
        aria-expanded={expanded}
      >
        <div className="min-w-0 flex-1 flex items-start gap-3">
          {icon ? (
            <IonIcon
              name={icon}
              size={22}
              className="text-[var(--color-primary)] shrink-0 mt-0.5"
            />
          ) : null}
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-gray-900">{title}</h2>
            {subtitle ? <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p> : null}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {badge ? (
            <span
              className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
              style={{ color: badgeColor, backgroundColor: `${badgeColor}18` }}
            >
              {badge}
            </span>
          ) : null}
          <IonIcon
            name={expanded ? "chevron-up" : "chevron-down"}
            size={20}
            className="text-gray-400"
          />
        </div>
      </button>
      {expanded ? (
        <div className="px-5 pb-5 pt-1 border-t border-gray-200 bg-white space-y-4">{children}</div>
      ) : null}
    </section>
  );
}
