import { RewardsPageHeader } from "@/components/RewardsPageHeader";
import { RewardsContent } from "@/components/RewardsContent";

export default function RewardsPage() {
  return (
    <>
      <RewardsPageHeader />
      <section className="py-12 px-4" style={{ padding: "var(--section-padding)" }}>
        <div className="max-w-[var(--max-width)] mx-auto">
          <RewardsContent />
        </div>
      </section>
    </>
  );
}
