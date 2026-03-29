"use client";

import Link from "next/link";
import { IonIcon } from "@/components/IonIcon";

const buttonClass =
  "flex flex-row items-center justify-center gap-3 w-full rounded-[10px] px-6 py-4 text-white font-semibold text-[17px] transition opacity-95 hover:opacity-100 no-underline";

const items: { href: string; label: string; icon: string }[] = [
  {
    href: "/business-hub/my-business-posts",
    label: "My Business Posts",
    icon: "megaphone-outline",
  },
  {
    href: "/business-hub/offered-rewards",
    label: "My Business Rewards",
    icon: "ribbon-outline",
  },
  {
    href: "/business-hub/offered-coupons",
    label: "My Business Coupons",
    icon: "pricetags-outline",
  },
  {
    href: "/business-hub/my-business-events",
    label: "My Business Events",
    icon: "calendar-outline",
  },
];

/** Full-width primary CTAs for Manage NWC Business (web); matches app hub styling. */
export function BusinessHubManageDirectoryLinks() {
  return (
    <nav className="flex flex-col gap-3 w-full max-w-2xl mx-auto" aria-label="Manage business content">
      {items.map(({ href, label, icon }) => (
        <Link
          key={href}
          href={href}
          className={buttonClass}
          style={{ backgroundColor: "var(--color-primary)" }}
        >
          <IonIcon name={icon} size={26} className="text-white shrink-0" />
          <span className="text-white">{label}</span>
        </Link>
      ))}
    </nav>
  );
}
