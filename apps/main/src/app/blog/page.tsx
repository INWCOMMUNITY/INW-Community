import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "database";
import { BlogCard } from "@/components/BlogCard";

export const dynamic = "force-dynamic";

export default async function BlogPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const { category } = await searchParams;
  const session = await getServerSession(authOptions);

  const where: { status: string; category?: { slug: string } } = { status: "approved" };
  if (category) where.category = { slug: category };

  const blogs = await prisma.blog.findMany({
    where,
    include: {
      member: { select: { id: true, firstName: true, lastName: true, profilePhotoUrl: true } },
      category: { select: { id: true, name: true, slug: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const categories = await prisma.blogCategory.findMany({
    orderBy: { name: "asc" },
  });

  return (
    <section className="py-12 px-4" style={{ padding: "var(--section-padding)" }}>
      <div className="max-w-[var(--max-width)] mx-auto">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
          <h1 className="text-3xl font-bold">Blog</h1>
          {session?.user?.id && (
            <Link href="/blog/new" className="btn">
              Post a blog
            </Link>
          )}
        </div>
        <div className="flex flex-wrap gap-2 mb-6">
          <Link
            href="/blog"
            className={`px-3 py-1 rounded text-sm ${!category ? "bg-[var(--color-primary)] text-white" : "bg-gray-200 hover:bg-gray-300"}`}
          >
            All
          </Link>
          {categories.map((c) => (
            <Link
              key={c.id}
              href={`/blog?category=${encodeURIComponent(c.slug)}`}
              className={`px-3 py-1 rounded text-sm ${category === c.slug ? "bg-[var(--color-primary)] text-white" : "bg-gray-200 hover:bg-gray-300"}`}
            >
              {c.name}
            </Link>
          ))}
        </div>
        {blogs.length === 0 ? (
          <p className="text-gray-500">No blogs yet. Check back soon!</p>
        ) : (
          <div className="space-y-6">
            {blogs.map((blog) => (
              <BlogCard key={blog.id} blog={blog} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
