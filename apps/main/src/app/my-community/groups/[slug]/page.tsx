import { redirect } from "next/navigation";
import { prisma } from "database";
import { getServerSession } from "@/lib/auth";

export default async function GroupManageRedirectPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const session = await getServerSession();
  const userId = session?.user && "id" in session.user ? (session.user as { id: string }).id : null;
  if (!userId) {
    redirect(`/login?callbackUrl=${encodeURIComponent(`/my-community/groups/${slug}`)}`);
  }

  const group = await prisma.group.findUnique({
    where: { slug },
    select: { id: true, createdById: true },
  });
  if (!group) {
    redirect("/my-community/groups");
  }

  const membership = await prisma.groupMember.findUnique({
    where: {
      groupId_memberId: { groupId: group.id, memberId: userId },
    },
    select: { role: true },
  });
  const isAdmin = group.createdById === userId || membership?.role === "admin";
  if (isAdmin) {
    redirect(`/my-community/groups/${slug}/admin`);
  }
  redirect(`/community-groups/${slug}`);
}
