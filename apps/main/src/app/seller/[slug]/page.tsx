import { redirect } from "next/navigation";

type Props = { params: Promise<{ slug: string }> };

/** Matches mobile app share links (`/seller/:slug`) → web seller storefront. */
export default async function SellerSlugRedirect({ params }: Props) {
  const { slug } = await params;
  redirect(`/support-local/sellers/${encodeURIComponent(slug)}`);
}
