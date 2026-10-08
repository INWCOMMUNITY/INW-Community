import { listingDisplayPhoto } from "@/lib/listing-display-photo";

/** Compact photo collage for Sync Airport synced-listing rows. */
export function AppsAirportListingPhotoCollage({
  photos,
  alt = "",
}: {
  photos?: string[] | null;
  alt?: string;
}) {
  const shown = (photos ?? [])
    .map((url) => listingDisplayPhoto(url, "thumb") ?? url)
    .filter(Boolean)
    .slice(0, 4);

  if (shown.length === 0) {
    return (
      <div
        className="h-12 w-12 shrink-0 rounded-md bg-neutral-100 border border-neutral-200"
        aria-hidden
      />
    );
  }

  if (shown.length === 1) {
    return (
      <div className="h-12 w-12 shrink-0 overflow-hidden rounded-md border border-neutral-200">
        <img src={shown[0]} alt={alt} className="h-full w-full object-cover" loading="lazy" />
      </div>
    );
  }

  if (shown.length === 2) {
    return (
      <div className="grid h-12 w-12 shrink-0 grid-cols-2 gap-0.5 overflow-hidden rounded-md border border-neutral-200">
        {shown.map((src, i) => (
          <img key={`${src}-${i}`} src={src} alt="" className="h-full w-full object-cover" loading="lazy" />
        ))}
      </div>
    );
  }

  if (shown.length === 3) {
    return (
      <div className="grid h-12 w-12 shrink-0 grid-cols-2 grid-rows-2 gap-0.5 overflow-hidden rounded-md border border-neutral-200">
        <img src={shown[0]} alt="" className="row-span-2 h-full w-full object-cover" loading="lazy" />
        <img src={shown[1]} alt="" className="h-full w-full object-cover" loading="lazy" />
        <img src={shown[2]} alt="" className="h-full w-full object-cover" loading="lazy" />
      </div>
    );
  }

  return (
    <div className="grid h-12 w-12 shrink-0 grid-cols-2 grid-rows-2 gap-0.5 overflow-hidden rounded-md border border-neutral-200">
      {shown.map((src, i) => (
        <img key={`${src}-${i}`} src={src} alt="" className="h-full w-full object-cover" loading="lazy" />
      ))}
    </div>
  );
}
