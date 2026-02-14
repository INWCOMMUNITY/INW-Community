import { notFound } from "next/navigation";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "database";
import { BlogDetail } from "@/components/BlogDetail";

export const dynamic = "force-dynamic";

export default async function BlogSlugPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const session = await getServerSession(authOptions);

  const blog = await prisma.blog.findFirst({
    where: { slug },
    include: {
      member: { select: { id: true, firstName: true, lastName: true, profilePhotoUrl: true } },
      category: { select: { id: true, name: true, slug: true } },
      blogTags: { include: { tag: { select: { id: true, name: true, slug: true } } } },
      comments: {
        include: {
          member: { select: { id: true, firstName: true, lastName: true, profilePhotoUrl: true } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!blog) notFound();
  if (blog.status !== "approved" && (!session?.user?.id || blog.memberId !== session.user.id)) {
    notFound();
  }

  let saved = false;
  let following = false;
  if (session?.user?.id) {
    const savedItem = await prisma.savedItem.findUnique({
      where: {
        memberId_type_referenceId: {
          memberId: session.user.id,
          type: "blog",
          referenceId: blog.id,
        },
      },
    });
    saved = !!savedItem;
    if (blog.member.id !== session.user.id) {
      const follow = await prisma.follow.findUnique({
        where: {
          followerId_followingId: {
            followerId: session.user.id,
            followingId: blog.member.id,
          },
        },
      });
      following = !!follow;
    }
  }

  return (
    <section className="py-12 px-4" style={{ padding: "var(--section-padding)" }}>
      <div className="max-w-[var(--max-width)] mx-auto">
        <Link href="/blog" className="text-sm text-gray-600 hover:underline mb-4 inline-block">
          ← Back to blog
        </Link>
        <BlogDetail
          blog={blog}
          sessionUserId={session?.user?.id ?? null}
          initialSaved={saved}
          initialFollowing={following}
        />
      </div>
    </section>
  );
}
