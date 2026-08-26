import type { ReactNode } from "react";

/** Outer shell — same horizontal bounds as `Header`. */
export const SITE_PAGE_SHELL = "max-w-[var(--max-width)] mx-auto px-3 sm:px-4";

/** Desktop center column — same flex band as Home–Members nav (`px-[0.5in]`). */
export const SITE_NAV_BAND = "min-w-0 px-[0.5in]";

/** Fixed left/right header columns so Store stays centered on the hero seal. */
export const SITE_HEADER_SIDE = "w-[12rem] min-w-[12rem] max-w-[12rem] shrink-0";

/** Matches `Header` desktop row: logo | flex-1 nav band | actions */
export const SITE_HEADER_ROW = "hidden md:flex md:items-start w-full";
export const SITE_HEADER_LOGO_SLOT = "hidden md:flex md:items-center shrink-0 relative";
export const SITE_HEADER_ACTIONS_SLOT =
  "hidden md:flex md:items-center md:justify-end md:gap-2 relative";

/** Below sticky site header — keep in sync with `globals.css` `--site-header-height`. */
export const SITE_STICKY_BELOW_HEADER = {
  top: "var(--site-header-height)",
} as const;

export function SiteHeaderLogoSpacer() {
  return (
    <div aria-hidden className={`invisible pointer-events-none ${SITE_HEADER_SIDE}`}>
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
    <div aria-hidden className={`invisible pointer-events-none flex items-center justify-end gap-2 ${SITE_HEADER_SIDE}`}>
      <span className="rounded-full px-5 py-2.5 sm:px-8 sm:py-2.5 font-medium text-sm sm:text-[1.1375rem] min-w-[9rem] text-center">
        Profile
      </span>
      <span className="inline-block h-9 w-9 rounded-full" />
    </div>
  );
}

/**
 * My Community shell: same 12rem | flex-1 | 12rem row as the header.
 * The INW Community box lives in the logo column so it sits under
 * “Northwest Community”.
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
      {/* Layout `children` must mount once — duplicating the App Router slot crashes with parallelRouterKey null. */}
      <div
        className={`flex flex-col gap-8 md:flex-row md:items-stretch md:gap-0 w-full overflow-visible ${className}`}
      >
        <div
          className={`relative hidden md:flex justify-center shrink-0 self-stretch min-h-0 ${SITE_HEADER_SIDE}`}
        >
          <div className="sticky w-fit max-w-full" style={SITE_STICKY_BELOW_HEADER}>
            {sidebar}
          </div>
        </div>
        <div className="min-w-0 flex-1 w-full self-stretch md:px-[0.5in]">{children}</div>
        <div className={`relative hidden md:block shrink-0 self-stretch min-h-0 ${SITE_HEADER_SIDE}`}>
          {asideRight ? (
            <div className="absolute inset-y-0 right-0 w-full max-w-[calc(100vw-2rem)] pointer-events-auto">
              <div
                className="sticky flex flex-col gap-6 w-full"
                style={SITE_STICKY_BELOW_HEADER}
              >
                {asideRight}
              </div>
            </div>
          ) : null}
        </div>
        <div className="w-full max-w-sm md:hidden">{sidebar}</div>
        {asideRight ? <div className="w-full md:hidden">{asideRight}</div> : null}
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
