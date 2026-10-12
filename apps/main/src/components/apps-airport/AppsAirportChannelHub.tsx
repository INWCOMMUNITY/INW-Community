import type { ReactNode } from "react";
import Link from "next/link";
import { AppsAirportChrome } from "@/components/apps-airport/AppsAirportChrome";
import { IonIcon } from "@/components/IonIcon";

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
  /** Connection Settings — long button on mobile; square gear on desktop. */
  settingsHref?: string;
  settingsLabel?: string;
  children: ReactNode;
}) {
  const slots = actions.slice(0, 3);

  /** Import = primary green; List Items = honey gold; Open Dashboard = earth brown. */
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
      <div className="mb-4 flex flex-wrap items-stretch gap-3">
        <div className="grid flex-1 min-w-0 grid-cols-1 sm:grid-cols-3 gap-3">
          {slots.map((action, index) => renderAction(action, index))}
          {settingsHref ? (
            <Link
              href={settingsHref}
              className={`${actionClassName(0)} sm:hidden`}
              prefetch={false}
            >
              {settingsLabel}
            </Link>
          ) : null}
        </div>
        {settingsHref ? (
          <Link
            href={settingsHref}
            className="btn !hidden sm:!inline-flex items-center justify-center !p-0 shrink-0 w-11 h-11 sm:self-stretch sm:h-auto sm:min-h-[2.75rem] aspect-square !text-white hover:!bg-[var(--color-secondary)] hover:!text-white"
            aria-label="Connection Settings"
            title="Connection Settings"
            prefetch={false}
          >
            <IonIcon name="settings-outline" size={22} className="text-white" />
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
