import { Metadata } from "next";
import Link from "next/link";
import { NWCSellersGallery } from "@/components/NWCSellersGallery";
import { getSiteImageUrl } from "@/lib/site-images";

const SECTION_BG = "var(--color-primary)";

export const metadata: Metadata = {
  title: "Local Sellers | Northwest Community",
  description: "Locally owned businesses and people who are actively working to make shopping locally more accessible to this community.",
};

export default async function LocalSellersPage() {
  const headerImageUrl =
    (await getSiteImageUrl("local-sellers-header")) ?? "/local-sellers-header.png";

  return (
    <>
      <header
        className="w-full overflow-hidden border-2"
        style={{ backgroundColor: SECTION_BG, borderColor: "var(--color-secondary)" }}
        aria-label="Local sellers"
      >
        <div className="mx-auto w-full max-w-[var(--max-width)] px-4 py-4 sm:px-6 sm:py-5 lg:px-8 lg:py-6">
          <div>
            <div
              className="w-full overflow-hidden rounded-xl border-2 shadow-lg"
              style={{ borderColor: "var(--color-secondary)" }}
            >
              <img
                src={headerImageUrl}
                alt="Trailhead parking with a van, pickup, and evergreen trees"
                className="block h-auto w-full"
              />
            </div>

            <div
              className="mx-auto mt-4 w-[92%] max-w-4xl rounded-xl border-2 bg-white px-5 py-5 sm:mt-5 sm:px-8 sm:py-6 md:px-10"
              style={{
                borderColor: "var(--color-secondary)",
                boxShadow: "0 10px 20px -8px rgba(0, 0, 0, 0.18)",
              }}
            >
              <h1
                className="font-bold leading-tight mb-3 break-words text-center"
                style={{
                  color: "var(--color-heading)",
                  fontFamily: "var(--font-heading)",
                  fontSize: "clamp(1.5rem, 2.6vw, 2.25rem)",
                }}
              >
                Local Sellers
              </h1>
              <p
                className="leading-relaxed break-words text-center"
                style={{
                  color: "var(--color-text)",
                  fontSize: "clamp(0.875rem, 1.2vw, 1.0625rem)",
                }}
              >
                Locally owned businesses and people who are actively working to make shopping locally more accessible to this community. Browse their storefronts, save your favorite sellers, and purchase goods. This is beneficial for our community, so thanks for being here.
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
