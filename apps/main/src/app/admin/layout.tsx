import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession();
  const callback = encodeURIComponent("/admin/dashboard");
  if (!session?.user) {
    redirect(`/login?callbackUrl=${callback}`);
  }
  const isAdmin = (session.user as { isAdmin?: boolean }).isAdmin;
  if (!isAdmin) {
    redirect(`/login?adminError=notAdmin&callbackUrl=${callback}`);
  }
  return <>{children}</>;
}
