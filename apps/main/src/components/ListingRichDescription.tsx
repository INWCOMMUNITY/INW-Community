import { sanitizeListingDescription } from "@/lib/channels/rich-description";

type Props = {
  description: string;
  className?: string;
};

/**
 * Renders StoreItem.description: sanitized HTML subset inherits site font/size/color.
 * Plain-text descriptions (no tags) keep whitespace via pre-wrap fallback.
 */
export function ListingRichDescription({ description, className }: Props) {
  const sanitized = sanitizeListingDescription(description);
  if (!sanitized) {
    return (
      <p className={className ?? "text-gray-600 whitespace-pre-wrap"}>{description}</p>
    );
  }
  const hasTags = /<[a-z][\s\S]*>/i.test(sanitized);
  if (!hasTags) {
    return (
      <p className={className ?? "text-gray-600 whitespace-pre-wrap"}>{sanitized}</p>
    );
  }
  return (
    <div
      className={
        className ??
        "text-gray-600 listing-rich-description [&_p]:mb-3 [&_ul]:mb-3 [&_ol]:mb-3 [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5 [&_li]:mb-1"
      }
      dangerouslySetInnerHTML={{ __html: sanitized }}
    />
  );
}
