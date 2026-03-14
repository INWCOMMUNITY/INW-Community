import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { SellerHubTopNav } from "@/components/SellerHubTopNav";

export const dynamic = "force-dynamic";

export default async function SellerHubLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/seller-hub");
  }
  return (
    <>
      <SellerHubTopNav />
      {children}
    </>
  );
}
