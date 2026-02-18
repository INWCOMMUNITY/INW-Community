import { Metadata } from "next";
import Link from "next/link";
import { NWCSellersGallery } from "@/components/NWCSellersGallery";

export const metadata: Metadata = {
  title: "Local Sellers | Northwest Community",
  description: "Shop from our community sellers. Browse storefronts and find unique items from local businesses.",
};

export default function SellersListPage() {
  return (
    <section
      className="py-12 px-4 min-h-screen"
      style={{ padding: "var(--section-padding)", backgroundColor: "#f8e7c9" }}
    >
      <div className="max-w-[var(--max-width)] mx-auto">
        <Link
          href="/support-local"
          className="inline-block mb-6 text-sm font-medium hover:underline"
          style={{ color: "var(--color-primary)" }}
        >
          ← Back to Support Local
        </Link>
        <h1 className="text-xl sm:text-2xl font-bold mb-6" style={{ fontFamily: "var(--font-heading)", color: "#000" }}>
          NWC Sellers
        </h1>
        <p className="mb-8 leading-relaxed opacity-90" style={{ color: "#000" }}>
          Shop from our community sellers. Browse their storefronts and find unique items from local businesses.
        </p>
        <NWCSellersGallery />
      </div>
    </section>
  );
}
