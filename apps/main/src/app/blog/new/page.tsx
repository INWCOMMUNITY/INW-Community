import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { BlogForm } from "@/components/BlogForm";

export const dynamic = "force-dynamic";

export default async function NewBlogPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/blog/new");
  }

  return (
    <section className="py-12 px-4" style={{ padding: "var(--section-padding)" }}>
      <div className="max-w-[var(--max-width)] mx-auto">
        <h1 className="text-3xl font-bold mb-8">Post a blog</h1>
        <BlogForm successRedirect="/blog" />
      </div>
    </section>
  );
}
