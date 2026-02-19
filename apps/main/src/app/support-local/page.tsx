import Link from "next/link";
import Image from "next/image";
import { SupportLocalGallery } from "@/components/SupportLocalGallery";
import { getSiteImageUrl } from "@/lib/site-images";

export default async function SupportLocalPage() {
  const [directoryBgUrl, supportLocalLogoUrl] = await Promise.all([
    getSiteImageUrl("directory-background"),
    getSiteImageUrl("support-local-logo"),
  ]);

  return (
    <>
      {/* Header: gallery photo wall to wall, height 1.6x; logo 1:1 centered */}
      <header className="w-full overflow-hidden relative border-2 border-[var(--color-secondary)]">
        <div className="w-full relative aspect-[2.62] min-h-[280px]">
          <Image
            src={directoryBgUrl ?? "/directory-background.jpg"}
            alt="Northwest Community – support local"
            fill
            className="object-cover object-center"
            sizes="(min-width: 2560px) 3840px, (min-width: 1920px) 2560px, 100vw"
            quality={100}
            priority
          />
          {/* Logo centered on photo, circle cropped */}
          <div className="absolute left-1/2 top-1/2 aspect-square w-[200px] sm:w-[240px] md:w-[280px] -translate-x-1/2 -translate-y-1/2 rounded-full overflow-hidden z-10">
            <img
              src={supportLocalLogoUrl ?? "/support-local-logo.png"}
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
    </>
  );
}
