import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth";
import { hasBusinessHubAccess } from "@/lib/business-hub-access";

export default async function MyBusinessEventsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession();
  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/business-hub/my-business-events");
  }
  const isAdmin = (session.user as { isAdmin?: boolean }).isAdmin === true;
  const hasAccess = isAdmin || (await hasBusinessHubAccess(session.user.id));
  if (!hasAccess) {
    redirect("/business-hub");
  }
  return <>{children}</>;
}
