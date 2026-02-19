import { prisma } from "database";
import { BadgesPageContent } from "@/components/BadgesPageContent";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Badges | Northwest Community",
  description: "Earn badges by participating in Northwest Community. See all badges you can unlock.",
};

export default async function BadgesPage() {
  const badges = await prisma.badge.findMany({
    orderBy: [{ order: "asc" }, { name: "asc" }],
  });

  return (
    <section className="py-12 px-4" style={{ padding: "var(--section-padding)" }}>
      <div className="max-w-[var(--max-width)] mx-auto">
        <BadgesPageContent allBadges={badges} />
      </div>
    </section>
  );
}
