import type { ReactNode } from "react";

/** Outer shell — same horizontal bounds as `Header`. */
export const SITE_PAGE_SHELL = "max-w-[var(--max-width)] mx-auto px-3 sm:px-4";

/** Desktop center column — same flex band as Home–Members nav (`px-[0.5in]`). */
export const SITE_NAV_BAND = "min-w-0 px-[0.5in]";

/** Matches `Header` desktop row: logo | flex-1 nav band | actions */
export const SITE_HEADER_ROW = "hidden md:flex md:items-start w-full";
export const SITE_HEADER_LOGO_SLOT = "hidden md:flex md:items-center shrink-0 relative";
export const SITE_HEADER_ACTIONS_SLOT =
  "hidden md:flex md:items-center md:justify-end md:gap-3 shrink-0 relative";

/** Below sticky site header — keep in sync with `globals.css` `--site-header-height`. */
export const SITE_STICKY_BELOW_HEADER = {
  top: "var(--site-header-height)",
} as const;

export function SiteHeaderLogoSpacer() {
  return (
    <div aria-hidden className="invisible pointer-events-none shrink-0">
      <div
        className="text-[1rem] sm:text-[1.2rem] md:text-[1.35rem] font-bold leading-tight text-center"
        style={{ fontFamily: "var(--font-heading)" }}
      >
        <span className="block">Northwest</span>
        <span className="block">Community</span>
      </div>
    </div>
  );
}

export function SiteHeaderActionsSpacer() {
  return (
    <div aria-hidden className="invisible pointer-events-none shrink-0 flex items-center gap-3">
      <span className="rounded-full px-3 py-2 sm:px-5 sm:py-2.5 font-medium text-sm sm:text-[1.1375rem] whitespace-nowrap">
        My Community
      </span>
    </div>
  );
}

/**
 * My Community shell: thin sidebar in the logo column, feed in the Home–Members nav band.
 */
export function MyCommunityNavGrid({
  sidebar,
  asideRight,
  children,
  className = "",
}: {
  sidebar: ReactNode;
  asideRight?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`${SITE_PAGE_SHELL} overflow-visible`}>
      {/* Desktop — grid matches header columns; sidebar absolute so it does not steal feed width */}
      <div
        className={`hidden md:grid md:grid-cols-[auto_1fr_auto] md:items-stretch w-full overflow-visible ${className}`}
      >
        <div className="relative shrink-0 self-stretch min-h-0 overflow-visible">
          <SiteHeaderLogoSpacer />
          <div className="absolute inset-y-0 left-0 -translate-x-6 w-[12rem] z-20 pointer-events-auto">
            <div className="sticky w-full" style={SITE_STICKY_BELOW_HEADER}>
              {sidebar}
            </div>
          </div>
        </div>
        <div className={`${SITE_NAV_BAND} min-w-0 self-stretch w-full`}>{children}</div>
        <div className="relative shrink-0 self-stretch min-h-0">
          <SiteHeaderActionsSpacer />
          {asideRight ? (
            <div className="absolute inset-y-0 right-0 w-[11.5rem] max-w-[calc(100vw-2rem)] pointer-events-auto">
              <div
                className="sticky flex flex-col gap-6 w-full"
                style={SITE_STICKY_BELOW_HEADER}
              >
                {asideRight}
              </div>
            </div>
          ) : null}
        </div>
      </div>
      {/* Mobile */}
      <div className={`flex flex-col gap-8 w-full md:hidden ${className}`}>
        <div className="order-1 min-w-0 w-full">{children}</div>
        <div className="order-2 w-full max-w-sm">{sidebar}</div>
        {asideRight ? <div className="order-3 w-full">{asideRight}</div> : null}
      </div>
    </div>
  );
}

/**
 * Constrains content to the same width as the desktop header nav (Home–Members).
 * Full width within the site shell on smaller screens.
 */
export function SiteNavAlignedColumn({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={SITE_PAGE_SHELL}>
      <div className={`${SITE_HEADER_ROW} ${className}`}>
        <div className={SITE_HEADER_LOGO_SLOT}>
          <SiteHeaderLogoSpacer />
        </div>
        <div className={`flex-1 min-w-0 ${SITE_NAV_BAND}`}>{children}</div>
        <div className={SITE_HEADER_ACTIONS_SLOT}>
          <SiteHeaderActionsSpacer />
        </div>
      </div>
      <div className={`md:hidden ${className}`}>{children}</div>
    </div>
  );
}
