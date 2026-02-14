import { CouponsPageHeader } from "@/components/CouponsPageHeader";
import { CouponBookGallery } from "@/components/CouponBookGallery";

export default function CouponsPage() {
  return (
    <>
      <CouponsPageHeader />
      <section className="py-12 px-4" style={{ padding: "var(--section-padding)" }}>
        <div className="max-w-[var(--max-width)] mx-auto">
          <CouponBookGallery />
        </div>
      </section>
    </>
  );
}
