import { apiGet } from "@/lib/api";

type StoreItemRow = {
  id: string;
  title: string;
  slug: string;
  photos: string[];
  condition?: string;
};

/**
 * Loads listing title + photos for share UI / chat previews when the parent
 * did not pass them or the public `ids=` lookup returned nothing (e.g. sold / inactive).
 */
/** One round-trip for multiple listing ids (active listings only). */
export async function fetchStoreItemsByIdsBatch(ids: string[]): Promise<Map<string, StoreItemRow>> {
  const clean = [...new Set(ids.map((x) => String(x).trim()).filter(Boolean))];
  if (clean.length === 0) return new Map();
  try {
    const rows = await apiGet<StoreItemRow[]>(
      `/api/store-items?ids=${clean.map((id) => encodeURIComponent(id)).join(",")}`
    );
    const map = new Map<string, StoreItemRow>();
    for (const r of Array.isArray(rows) ? rows : []) {
      if (r?.id && r.title) map.set(r.id, r);
    }
    return map;
  } catch {
    return new Map();
  }
}

export async function fetchStoreItemPreviewPayload(shared: {
  id: string;
  slug?: string;
}): Promise<StoreItemRow | null> {
  if (shared.id) {
    try {
      const batch = await fetchStoreItemsByIdsBatch([shared.id]);
      const hit = batch.get(shared.id);
      if (hit?.title) return hit;
    } catch {
      /* try slug */
    }
  }
  const slug = shared.slug?.trim();
  if (!slug) return null;
  const attempts: { includeUnavailable?: boolean }[] = [
    {},
    { includeUnavailable: true },
  ];
  for (const a of attempts) {
    try {
      const q = `/api/store-items?slug=${encodeURIComponent(slug)}${
        a.includeUnavailable ? "&includeUnavailable=1" : ""
      }`;
      const data = await apiGet<StoreItemRow>(q);
      if (data?.title && data.id) return data;
    } catch {
      /* next */
    }
  }
  return null;
}
