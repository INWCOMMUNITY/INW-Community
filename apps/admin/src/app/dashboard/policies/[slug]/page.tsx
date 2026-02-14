import { PolicyEditor } from "./PolicyEditor";

export default async function AdminPolicyEditPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return (
    <div>
      <PolicyEditor slug={slug} />
    </div>
  );
}
