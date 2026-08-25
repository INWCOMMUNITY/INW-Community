import { Metadata } from "next";
import Link from "next/link";
import { IonIcon } from "@/components/IonIcon";
import { NWCSellersGallery } from "@/components/NWCSellersGallery";
import { getSiteImageUrl } from "@/lib/site-images";

const SECTION_BG = "var(--color-earth)";

export const metadata: Metadata = {
  title: "Local Sellers | Northwest Community",
  description:
    "Here is a list of local online retailers who have teamed up with Northwest Community to make local online shopping a possibility. Sift through the sellers below and find items you will love!",
};

export default async function LocalSellersPage() {
  const headerImageUrl =
    (await getSiteImageUrl("local-sellers-header")) ?? "/local-sellers-header.png";

  return (
    <>
      <header
        className="w-full border-2"
        style={{ backgroundColor: SECTION_BG, borderColor: "var(--color-secondary)" }}
        aria-label="Local sellers"
      >
        <div className="mx-auto w-full max-w-[var(--max-width)] px-4 py-4 sm:px-6 sm:py-5 lg:px-8 lg:py-6">
          <div className="relative">
            <div
              className="w-full overflow-hidden rounded-xl border-2 shadow-lg"
              style={{ borderColor: "var(--color-secondary)" }}
            >
              <img
                src={headerImageUrl}
                alt="Trailhead parking with a van, pickup, and evergreen trees"
                className="block h-auto w-full -mt-[1.25in] md:-mt-[2in]"
              />
            </div>

            <div
              className="absolute bottom-6 left-1/2 z-10 w-[92%] max-w-4xl -translate-x-1/2 rounded-xl border-2 bg-white px-5 py-5 sm:bottom-8 sm:px-8 sm:py-6 md:px-10"
              style={{
                borderColor: "var(--color-secondary)",
                boxShadow: "0 10px 20px -8px rgba(0, 0, 0, 0.18)",
              }}
            >
              <h1
                className="mb-3 flex items-center justify-center gap-2.5 break-words text-center font-bold leading-tight"
                style={{
                  color: "var(--color-heading)",
                  fontFamily: "var(--font-heading)",
                  fontSize: "clamp(1.5rem, 2.6vw, 2.25rem)",
                }}
              >
                <IonIcon name="storefront-outline" size={32} className="shrink-0" />
                Local Sellers
              </h1>
              <p
                className="leading-relaxed break-words text-center"
                style={{
                  color: "var(--color-text)",
                  fontSize: "clamp(0.875rem, 1.2vw, 1.0625rem)",
                }}
              >
                Here is a list of local online retailers who have teamed up with Northwest Community to make local
                online shopping a possibility. Sift through the sellers below and find items you will love!
              </p>
            </div>
          </div>
        </div>
      </header>

      <section
        className="py-12 px-4 min-h-screen"
        style={{ padding: "var(--section-padding)", backgroundColor: "#ffffff" }}
      >
        <div className="max-w-[var(--max-width)] mx-auto">
          <Link
            href="/support-local"
            className="inline-block mb-6 text-sm font-medium hover:underline"
            style={{ color: "var(--color-primary)" }}
          >
            ← Back to Support Local
          </Link>
          <NWCSellersGallery />
        </div>
      </section>
    </>
  );
}
