import Link from "next/link";
import { SupportLocalGallery } from "@/components/SupportLocalGallery";
import { NWCSellersGallery } from "@/components/NWCSellersGallery";
import { WIX_IMG } from "@/lib/wix-media";

/** Header photo from https://www.pnwcommunity.com/gallery – direct Wix URL for reliable loading */
const SUPPORT_LOCAL_HEADER_IMAGE = WIX_IMG(
  "2bdd49_26cd29bec17e4bb5b2990254f09f85d2~mv2.jpg/v1/fill/w_1810,h_432,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/background.jpg"
);
const SUPPORT_LOCAL_LOGO = "/support-local-logo.png";

export default function SupportLocalPage() {
  return (
    <>
      {/* Header: gallery photo wall to wall, height 1.6x; logo 1:1 centered */}
      <header className="w-full overflow-hidden relative border-2 border-[var(--color-secondary)]">
        <div className="w-full relative aspect-[2.62] min-h-[280px]">
          <img
            src={SUPPORT_LOCAL_HEADER_IMAGE}
            alt="Northwest Community – support local"
            className="absolute inset-0 w-full h-full object-cover object-center"
          />
          {/* Logo centered on photo, circle cropped */}
          <div className="absolute left-1/2 top-1/2 aspect-square w-[200px] sm:w-[240px] md:w-[280px] -translate-x-1/2 -translate-y-1/2 rounded-full overflow-hidden z-10">
            <img
              src={SUPPORT_LOCAL_LOGO}
              alt="Northwest Community"
              className="w-full h-full object-cover object-center"
            />
          </div>
        </div>
      </header>

      {/* Tan box: one-line title, reduced size */}
      <section
        className="w-full py-6 px-4 sm:px-6 border-2 border-[var(--color-secondary)]"
        style={{ backgroundColor: "#f8e7c9" }}
      >
        <div className="max-w-3xl mx-auto text-center">
          <h1
            className="text-xl sm:text-2xl font-bold mb-3 whitespace-nowrap overflow-hidden text-ellipsis max-w-full"
            style={{ fontFamily: "var(--font-heading)", color: "#000" }}
          >
            Local Business Directory
          </h1>
          <p className="mb-6 leading-relaxed opacity-90" style={{ color: "#000" }}>
            Check out the local companies that make this business possible. Without our sponsors, our company cannot succeed. So thank you to our sponsors, and thank you for the services you provide to keep this area thriving! Check out their business information, purchase items from them with our storefront, or submit request forms to local businesses.
          </p>
          <Link
            href="/sponsor-nwc"
            className="btn inline-block"
            style={{
              backgroundColor: "var(--color-button)",
              color: "var(--color-button-text)",
            }}
          >
            Join the Directory!
          </Link>
        </div>
      </section>

      <section className="py-12 px-4" style={{ padding: "var(--section-padding)" }}>
        <div className="max-w-[var(--max-width)] mx-auto">
          <SupportLocalGallery />
        </div>
      </section>

      <section className="py-12 px-4 border-t-2 border-[var(--color-secondary)]" style={{ padding: "var(--section-padding)", backgroundColor: "#f8e7c9" }}>
        <div className="max-w-[var(--max-width)] mx-auto">
          <h2 className="text-xl sm:text-2xl font-bold mb-6" style={{ fontFamily: "var(--font-heading)", color: "#000" }}>
            NWC Sellers
          </h2>
          <p className="mb-8 leading-relaxed opacity-90" style={{ color: "#000" }}>
            Shop from our community sellers. Browse their storefronts and find unique items from local businesses.
          </p>
          <NWCSellersGallery />
        </div>
      </section>
    </>
  );
}
