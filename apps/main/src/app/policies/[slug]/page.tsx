import { notFound } from "next/navigation";
import { prisma } from "database";
import Link from "next/link";

export default async function PolicyPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const policy = await prisma.policy.findUnique({
    where: { slug },
  });
  if (!policy) notFound();

  return (
    <section className="py-12 px-4" style={{ padding: "var(--section-padding)" }}>
      <div className="max-w-[var(--max-width)] mx-auto prose prose-gray max-w-none">
        <Link href="/" className="text-sm text-gray-600 hover:underline mb-4 inline-block">
          ← Northwest Community
        </Link>
        <h1 className="text-3xl font-bold mb-6">{policy.title}</h1>
        <div className="whitespace-pre-wrap text-gray-700">{policy.content}</div>
      </div>
    </section>
  );
}
