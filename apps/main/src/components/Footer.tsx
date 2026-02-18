import Link from "next/link";
import { NWCRequestsTrigger } from "./NWCRequestsTrigger";

export function Footer() {
  return (
    <footer className="bg-white border-t-2 border-[var(--color-primary)] mt-auto no-print">
      <div className="max-w-[var(--max-width)] mx-auto px-4 py-6 text-center text-sm" style={{ color: "var(--color-text)" }}>
        <p>
          Northwest Community<br />
          Connecting Eastern Washington & North Idaho Residents & Local Businesses
        </p>
        <div className="mt-4 mb-4">
          <NWCRequestsTrigger />
        </div>
        <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-sm" style={{ display: "flex", flexWrap: "wrap", gap: "1rem", justifyContent: "center" }}>
          <Link href="/about" className="hover:underline">About NWC</Link>
          <span className="opacity-50" style={{ color: "var(--color-primary)" }} aria-hidden>·</span>
          <Link href="/calendars" className="hover:underline">Calendars</Link>
          <span className="opacity-50" style={{ color: "var(--color-primary)" }} aria-hidden>·</span>
          <Link href="/support-local" className="hover:underline">Local Businesses</Link>
          <span className="opacity-50" style={{ color: "var(--color-primary)" }} aria-hidden>·</span>
          <Link href="/storefront" className="hover:underline">Storefront</Link>
          <span className="opacity-50" style={{ color: "var(--color-primary)" }} aria-hidden>·</span>
          <Link href="/coupons" className="hover:underline">Coupons</Link>
          <span className="opacity-50" style={{ color: "var(--color-primary)" }} aria-hidden>·</span>
          <Link href="/support-nwc" className="hover:underline">Subscribe</Link>
          <span className="opacity-50" style={{ color: "var(--color-primary)" }} aria-hidden>·</span>
          <Link href="/terms" className="hover:underline">Terms</Link>
          <span className="opacity-50" style={{ color: "var(--color-primary)" }} aria-hidden>·</span>
          <Link href="/privacy" className="hover:underline">Privacy</Link>
        </div>
      </div>
    </footer>
  );
}
