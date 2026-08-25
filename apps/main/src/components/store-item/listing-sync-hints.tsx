export const LISTING_SYNC_HINTS = {
  photos: "Pushes listing photos to connected stores when you save.",
  title: "Pushes title and description to connected stores when you save.",
  sku: "Pushes this SKU to connected stores when you save. eBay needs letters and numbers only.",
  price: "Pushes price to connected stores when you save.",
  quantity: "Updates inventory on all connected stores when you save.",
  condition: "Required for eBay listings. Changing condition re-syncs eBay.",
} as const;

export function SyncFieldHint({ text }: { text: string }) {
  return (
    <p className="text-xs text-[var(--color-primary)]/80 mt-1 flex items-start gap-1">
      <span aria-hidden className="shrink-0">
        ↗
      </span>
      <span>{text}</span>
    </p>
  );
}
