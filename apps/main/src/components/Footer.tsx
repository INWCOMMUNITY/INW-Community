import Link from "next/link";
import { NWCRequestsTrigger } from "./NWCRequestsTrigger";

const FOOTER_INK = "#ffffff";

export function Footer() {
  return (
    <footer className="mt-auto no-print" style={{ backgroundColor: "var(--color-earth)", color: FOOTER_INK }}>
      <div className="max-w-[var(--max-width)] mx-auto px-4 py-10 text-sm">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 text-center sm:text-left">
          <div>
            <p className="font-semibold mb-2" style={{ fontFamily: "var(--font-heading)" }}>
              Northwest Community
            </p>
            <p className="leading-relaxed opacity-90">
              Connecting Eastern Washington & North Idaho Residents & Local Businesses
            </p>
          </div>
          <div>
            <h2 className="text-base font-semibold mb-3" style={{ fontFamily: "var(--font-heading)", color: FOOTER_INK }}>
              Explore
            </h2>
            <ul className="space-y-2">
              <li><Link href="/about" className="hover:underline" style={{ color: FOOTER_INK }}>About</Link></li>
              <li><Link href="/calendars" className="hover:underline" style={{ color: FOOTER_INK }}>Calendars</Link></li>
              <li><Link href="/support-local" className="hover:underline" style={{ color: FOOTER_INK }}>Local Businesses</Link></li>
              <li><Link href="/storefront" className="hover:underline" style={{ color: FOOTER_INK }}>Storefront</Link></li>
              <li><Link href="/coupons" className="hover:underline" style={{ color: FOOTER_INK }}>Coupons</Link></li>
            </ul>
          </div>
          <div>
            <h2 className="text-base font-semibold mb-3" style={{ fontFamily: "var(--font-heading)", color: FOOTER_INK }}>
              Get Involved
            </h2>
            <ul className="space-y-2">
              <li><Link href="/download-app" className="hover:underline" style={{ color: FOOTER_INK }}>Download App</Link></li>
              <li><Link href="/support-nwc" className="hover:underline" style={{ color: FOOTER_INK }}>Subscribe</Link></li>
              <li><NWCRequestsTrigger variant="link" /></li>
            </ul>
          </div>
          <div>
            <h2 className="text-base font-semibold mb-3" style={{ fontFamily: "var(--font-heading)", color: FOOTER_INK }}>
              Legal
            </h2>
            <ul className="space-y-2">
              <li><Link href="/terms" className="hover:underline" style={{ color: FOOTER_INK }}>Terms</Link></li>
              <li><Link href="/privacy" className="hover:underline" style={{ color: FOOTER_INK }}>Privacy</Link></li>
            </ul>
          </div>
        </div>
      </div>
    </footer>
  );
}
