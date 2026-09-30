import type { ReactNode } from "react";
import Link from "next/link";
import { AppsAirportChrome } from "@/components/apps-airport/AppsAirportChrome";

export type AppsAirportChannelHubAction = {
  label: string;
  href: string;
  disabled?: boolean;
};

export function AppsAirportChannelHub({
  title,
  subtitle,
  crumbs,
  statusDetail,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  crumbs?: Array<{ href: string; label: string }>;
  /** Thin line under actions (shop domain, remount, location). */
  statusDetail?: ReactNode;
  actions: AppsAirportChannelHubAction[];
  children: ReactNode;
}) {
  const slots = actions.slice(0, 3);
  while (slots.length < 3) {
    slots.push({ label: "—", href: "#", disabled: true });
  }

  return (
    <AppsAirportChrome title={title} subtitle={subtitle} crumbs={crumbs}>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        {slots.map((action) =>
          action.disabled ? (
            <span
              key={action.label}
              className="btn text-center opacity-50 cursor-not-allowed pointer-events-none"
              aria-disabled="true"
            >
              {action.label}
            </span>
          ) : (
            <Link
              key={action.label + action.href}
              href={action.href}
              className="btn text-center"
              prefetch={false}
            >
              {action.label}
            </Link>
          )
        )}
      </div>
      {statusDetail ? (
        <div className="mb-6 text-sm text-neutral-700">{statusDetail}</div>
      ) : null}
      {children}
    </AppsAirportChrome>
  );
}
