import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { HubWebChrome } from "@/components/HubWebChrome";

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
  return <HubWebChrome variant="seller">{children}</HubWebChrome>;
}
