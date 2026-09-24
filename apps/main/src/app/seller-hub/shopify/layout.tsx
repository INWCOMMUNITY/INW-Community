import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { memberHasStorefrontListingAccess } from "@/lib/storefront-seller-access";

export default async function ShopifyConnectionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/seller-hub/shopify");
  }
  const ok = await memberHasStorefrontListingAccess(session.user.id);
  if (!ok) {
    redirect("/seller-hub");
  }
  return <>{children}</>;
}
