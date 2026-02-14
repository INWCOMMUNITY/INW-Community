import Link from "next/link";
import { prisma } from "database";
import { AdminBlogActions } from "./AdminBlogActions";

const MAIN_URL = process.env.NEXT_PUBLIC_MAIN_SITE_URL || "http://localhost:3000";

export const dynamic = "force-dynamic";

export default async function AdminBlogsPage() {
  const [pendingBlogs, approvedBlogs] = await Promise.all([
    prisma.blog.findMany({
      where: { status: "pending" },
      include: {
        member: { select: { firstName: true, lastName: true } },
        category: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.blog.findMany({
      where: { status: "approved" },
      include: {
        member: { select: { firstName: true, lastName: true } },
        category: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Blogs</h1>
        {pendingBlogs.length > 0 && (
          <span className="bg-amber-100 text-amber-800 text-sm font-medium px-2 py-1 rounded">
            {pendingBlogs.length} pending
          </span>
        )}
      </div>

      {pendingBlogs.length > 0 && (
        <div className="mb-8">
          <h2 className="text-lg font-semibold mb-4">Pending approval</h2>
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Title</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Category</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Author</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {pendingBlogs.map((b) => (
                  <tr key={b.id}>
                    <td className="px-4 py-2 font-medium">
                      <Link
                        href={`${MAIN_URL}/blog/${b.slug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:underline"
                      >
                        {b.title}
                      </Link>
                    </td>
                    <td className="px-4 py-2">{b.category.name}</td>
                    <td className="px-4 py-2">{b.member.firstName} {b.member.lastName}</td>
                    <td className="px-4 py-2">{new Date(b.createdAt).toLocaleDateString()}</td>
                    <td className="px-4 py-2">
                      <AdminBlogActions blogId={b.id} status={b.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <h2 className="text-lg font-semibold mb-4">Approved blogs</h2>
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Title</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Category</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Author</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {approvedBlogs.map((b) => (
              <tr key={b.id}>
                <td className="px-4 py-2 font-medium">
                  <Link
                    href={`${MAIN_URL}/blog/${b.slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:underline"
                  >
                    {b.title}
                  </Link>
                </td>
                <td className="px-4 py-2">{b.category.name}</td>
                <td className="px-4 py-2">{b.member.firstName} {b.member.lastName}</td>
                <td className="px-4 py-2">{new Date(b.createdAt).toLocaleDateString()}</td>
                <td className="px-4 py-2">
                  <AdminBlogActions blogId={b.id} status={b.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {approvedBlogs.length === 0 && pendingBlogs.length === 0 && (
        <p className="text-gray-500">No blogs yet.</p>
      )}
    </div>
  );
}
