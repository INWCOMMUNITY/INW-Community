import { StorefrontHomeClient } from "@/components/store/StorefrontHomeClient";
import { getStorefrontHomeData } from "@/lib/storefront-browse-data";

function firstQuery(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export default async function StorefrontPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const category = firstQuery(params.category);
  const subcategory = firstQuery(params.subcategory);
  const size = firstQuery(params.size);
  const search = firstQuery(params.search);
  const conditionRaw = firstQuery(params.condition);
  const condition = conditionRaw === "new" || conditionRaw === "used" ? conditionRaw : null;
  const minPrice = firstQuery(params.minPrice);
  const maxPrice = firstQuery(params.maxPrice);
  const minPriceCents = minPrice ? Math.round(parseFloat(minPrice) * 100) : null;
  const maxPriceCents = maxPrice ? Math.round(parseFloat(maxPrice) * 100) : null;

  const { featured, items, meta, spotlight } = await getStorefrontHomeData({
    category: category || undefined,
    subcategory: subcategory || undefined,
    size: size || undefined,
    search: search || undefined,
    condition,
    localDelivery: firstQuery(params.localDelivery) === "1",
    shippingOnly: firstQuery(params.shippingOnly) === "1",
    minPriceCents,
    maxPriceCents,
    limit: 48,
    offset: 0,
  });

  return (
    <StorefrontHomeClient
      initialSearch={search}
      featured={featured}
      items={items}
      meta={meta}
      spotlight={spotlight.filter((s) => s.businessSlug)}
    />
  );
}
