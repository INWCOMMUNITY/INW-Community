import type { ReactNode } from "react";
import Link from "next/link";
import { AppsAirportListingPhotoCollage } from "@/components/apps-airport/AppsAirportListingPhotoCollage";

/** Mobile stacked card for Sync Airport listing rows (matches My Items Listed layout). */
export function AppsAirportListingMobileCard({
  href,
  title,
  photos,
  status,
  statusClassName,
  quantity,
  price,
  issueMessage,
  extraMeta,
  manage,
  viewOn,
}: {
  href: string;
  title: string;
  photos?: string[] | null;
  status: string;
  statusClassName: string;
  quantity: ReactNode;
  price: ReactNode;
  issueMessage?: string | null;
  /** Optional line under qty/price (e.g. Synced with). */
  extraMeta?: ReactNode;
  manage: ReactNode;
  viewOn?: ReactNode;
}) {
  return (
    <li className="bg-white px-4 py-3">
      <div className="flex gap-3">
        <AppsAirportListingPhotoCollage photos={photos} alt={title} />
        <div className="min-w-0 flex-1">
          <Link
            href={href}
            className="font-medium underline line-clamp-2 text-sm"
            style={{ color: "var(--color-primary)" }}
            prefetch={false}
          >
            {title}
          </Link>
          {issueMessage ? (
            <div className="mt-1 text-xs text-amber-800">{issueMessage}</div>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-700">
            <span
              className={`inline-flex rounded-full border px-2 py-0.5 font-semibold ${statusClassName}`}
            >
              {status}
            </span>
            <span>Qty {quantity}</span>
            <span>{price}</span>
          </div>
          {extraMeta ? <div className="mt-1 text-xs text-neutral-600">{extraMeta}</div> : null}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {manage}
            {viewOn}
          </div>
        </div>
      </div>
    </li>
  );
}
