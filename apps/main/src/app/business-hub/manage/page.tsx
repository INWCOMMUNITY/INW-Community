import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth";
import { hasBusinessHubAccess } from "@/lib/business-hub-access";
import { BusinessHubManageDirectoryLinks } from "@/components/BusinessHubManageDirectoryLinks";

export const dynamic = "force-dynamic";

export default async function BusinessHubManagePage() {
  const session = await getServerSession();
  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/business-hub/manage");
  }
  const isAdmin = (session.user as { isAdmin?: boolean }).isAdmin === true;
  const hasAccess = isAdmin || (await hasBusinessHubAccess(session.user.id));
  if (!hasAccess) {
    redirect("/business-hub");
  }

  return (
    <section className="py-12 px-4" style={{ padding: "var(--section-padding)" }}>
      <div className="max-w-[var(--max-width)] mx-auto">
        <div className="mb-8 flex flex-wrap gap-x-6 gap-y-2">
          <Link
            href="/business-hub"
            className="text-sm font-medium hover:underline"
            style={{ color: "var(--color-primary)" }}
          >
            ← Business Hub
          </Link>
        </div>

        <h1 className="text-2xl font-bold mb-2" style={{ color: "var(--color-heading)" }}>
          Manage NWC Business
        </h1>
        <p className="text-gray-600 mb-8">
          Three links: your business posts, rewards, and coupons—same destinations as in the app.
        </p>

        <BusinessHubManageDirectoryLinks />
      </div>
    </section>
  );
}
