import type { ReactNode } from "react";
import Link from "next/link";
import { APPS_AIRPORT_PATH } from "@/lib/shopify/apps-airport";

export function AppsAirportChrome({
  title,
  subtitle,
  crumbs,
  children,
}: {
  title: string;
  subtitle?: string;
  crumbs?: Array<{ href: string; label: string }>;
  children: ReactNode;
}) {
  return (
    <section className="py-8 px-4" style={{ padding: "var(--section-padding)" }}>
      <div className="max-w-[var(--max-width)] xl:max-w-[1100px] mx-auto">
        <nav className="mb-4 flex flex-wrap items-center gap-2 text-sm text-neutral-600">
          <Link href="/seller-hub" className="hover:underline" prefetch={false}>
            Seller Hub
          </Link>
          <span aria-hidden>/</span>
          <Link href={APPS_AIRPORT_PATH} className="hover:underline" prefetch={false}>
            Apps Airport
          </Link>
          {(crumbs ?? []).map((crumb) => (
            <span key={crumb.href} className="contents">
              <span aria-hidden>/</span>
              <Link href={crumb.href} className="hover:underline" prefetch={false}>
                {crumb.label}
              </Link>
            </span>
          ))}
        </nav>
        <h1
          className="text-2xl md:text-3xl font-bold"
          style={{ fontFamily: "var(--font-heading)", color: "var(--color-heading)" }}
        >
          {title}
        </h1>
        {subtitle ? <p className="mt-2 text-neutral-600 max-w-2xl">{subtitle}</p> : null}
        <div className="mt-8">{children}</div>
      </div>
    </section>
  );
}
