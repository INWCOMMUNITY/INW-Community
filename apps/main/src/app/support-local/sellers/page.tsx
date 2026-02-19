import { Metadata } from "next";
import Link from "next/link";
import { WIX_IMG } from "@/lib/wix-media";
import { NWCSellersGallery } from "@/components/NWCSellersGallery";

const LOCAL_SELLERS_HEADER_IMAGE =
  "2bdd49_e1e0586237f84ed0aa7a2403118573ca~mv2.jpg/v1/fill/w_1810,h_432,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/SPonsor.jpg";

export const metadata: Metadata = {
  title: "Local Sellers | Northwest Community",
  description: "Locally owned businesses and people who are actively working to make shopping locally more accessible to this community.",
};

export default function LocalSellersPage() {
  return (
    <>
      <header
        className="relative w-full h-[500px] min-h-[500px] flex items-center justify-center overflow-hidden bg-gray-900"
        style={{
          backgroundImage: `url(${WIX_IMG(LOCAL_SELLERS_HEADER_IMAGE)})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
        }}
      >
        <div className="relative z-10 w-full max-w-2xl mx-auto px-4 py-6 md:px-6 md:py-10">
          <div className="bg-white/60 backdrop-blur-sm rounded-lg shadow-lg p-6 max-md:p-4 md:p-10 text-center max-md:max-w-[320px] max-md:mx-auto">
            <h1 className="text-[2rem] max-md:text-xl md:text-4xl font-bold mb-3 max-md:mb-2 text-black">
              Local Sellers
            </h1>
            <p className="text-black leading-relaxed max-md:text-sm">
              Locally owned businesses and people who are actively working to make shopping locally more accessible to this community. Browse their storefronts, save your favorite sellers, and purchase goods. This is beneficial for our community, so thanks for being here.
            </p>
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
