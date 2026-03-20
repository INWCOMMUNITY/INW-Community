import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { memberHasStorefrontListingAccess } from "@/lib/storefront-seller-access";

export default async function ShippingSetupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/seller-hub/shipping-setup");
  }
  const ok = await memberHasStorefrontListingAccess(session.user.id);
  if (!ok) {
    redirect("/seller-hub");
  }
  return (
    <div className="py-8" style={{ padding: "var(--section-padding)" }}>
      <main className="max-w-[var(--max-width)] xl:max-w-[1520px] mx-auto">{children}</main>
    </div>
  );
}
