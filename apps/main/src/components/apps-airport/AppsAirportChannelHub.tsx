import type { ReactNode } from "react";
import Link from "next/link";
import { AppsAirportChrome } from "@/components/apps-airport/AppsAirportChrome";

export type AppsAirportChannelHubAction = {
  label: string;
  href: string;
  disabled?: boolean;
  /** Open in a new tab (seller dashboards). */
  external?: boolean;
};

export function AppsAirportChannelHub({
  title,
  subtitle,
  crumbs,
  statusDetail,
  actions,
  settingsHref,
  settingsLabel = "Settings",
  children,
}: {
  title: string;
  subtitle?: string;
  crumbs?: Array<{ href: string; label: string }>;
  /** Thin line under actions (shop domain, remount, location). */
  statusDetail?: ReactNode;
  /** Primary actions: Import, List Items, Open Dashboard (up to 3). */
  actions: AppsAirportChannelHubAction[];
  /** Connection Settings — full-width fourth button on mobile; 4th column on desktop. */
  settingsHref?: string;
  settingsLabel?: string;
  children: ReactNode;
}) {
  const slots = actions.slice(0, 3);

  /** Import = primary green; List Items = honey gold; Open Dashboard = earth brown; Settings = primary. */
  function actionClassName(index: number): string {
    const base = "btn text-center w-full transition-colors";
    if (index === 1) {
      return `${base} !bg-[#c99d5f] !text-white hover:!bg-[#b8894d] hover:!text-white`;
    }
    if (index === 2) {
      return `${base} !bg-[var(--color-earth)] !text-white hover:!bg-[#4a3f33] hover:!text-white`;
    }
    return `${base} !text-white hover:!bg-[var(--color-secondary)] hover:!text-white`;
  }

  function renderAction(
    action: AppsAirportChannelHubAction,
    index: number,
    keyPrefix = ""
  ) {
    const className = actionClassName(index);
    const key = `${keyPrefix}${action.label}-${action.href}`;
    if (action.disabled) {
      return (
        <span
          key={key}
          className={`${className} opacity-50 cursor-not-allowed pointer-events-none`}
          aria-disabled="true"
        >
          {action.label}
        </span>
      );
    }
    if (action.external) {
      return (
        <a
          key={key}
          href={action.href}
          target="_blank"
          rel="noopener noreferrer"
          className={className}
        >
          {action.label}
        </a>
      );
    }
    return (
      <Link key={key} href={action.href} className={className} prefetch={false}>
        {action.label}
      </Link>
    );
  }

  return (
    <AppsAirportChrome title={title} subtitle={subtitle} crumbs={crumbs}>
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {slots.map((action, index) => renderAction(action, index))}
        {settingsHref ? (
          <Link
            href={settingsHref}
            className={actionClassName(0)}
            prefetch={false}
          >
            {settingsLabel}
          </Link>
        ) : null}
      </div>
      {statusDetail ? (
        <div className="mb-6 text-sm text-neutral-700">{statusDetail}</div>
      ) : null}
      {children}
    </AppsAirportChrome>
  );
}
