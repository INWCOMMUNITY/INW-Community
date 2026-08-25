"use client";

type ListingPhotoPyramidProps = {
  photos: string[];
  size?: number;
};

/** Overlapping 1-over-2 photo stack for listing-collection feed cards. */
export function ListingPhotoPyramid({ photos, size = 56 }: ListingPhotoPyramidProps) {
  const shown = photos.filter(Boolean).slice(0, 3);
  if (shown.length === 0) {
    return (
      <div
        className="shrink-0 rounded-lg"
        style={{
          width: size * 1.7,
          height: size * 1.55,
          backgroundColor: "var(--color-section-alt)",
        }}
        aria-hidden
      />
    );
  }
  const width = size * 1.75;
  const height = size * 1.6;
  if (shown.length === 1) {
    return (
      <div className="relative shrink-0" style={{ width, height }} aria-hidden>
        <img
          src={shown[0]}
          alt=""
          className="absolute rounded-lg object-cover ring-2 ring-white"
          style={{
            width: size,
            height: size,
            left: (width - size) / 2,
            top: (height - size) / 2,
          }}
          width={size}
          height={size}
        />
      </div>
    );
  }
  return (
    <div className="relative shrink-0" style={{ width, height }} aria-hidden>
      <img
        src={shown[0]}
        alt=""
        className="absolute rounded-lg object-cover ring-2 ring-white"
        style={{
          width: size,
          height: size,
          left: (width - size) / 2,
          top: 0,
          zIndex: 3,
        }}
        width={size}
        height={size}
      />
      <img
        src={shown[1]}
        alt=""
        className="absolute rounded-lg object-cover ring-2 ring-white"
        style={{
          width: size,
          height: size,
          left: 0,
          bottom: 0,
          zIndex: 2,
        }}
        width={size}
        height={size}
      />
      {shown[2] ? (
        <img
          src={shown[2]}
          alt=""
          className="absolute rounded-lg object-cover ring-2 ring-white"
          style={{
            width: size,
            height: size,
            right: 0,
            bottom: 0,
            zIndex: 1,
          }}
          width={size}
          height={size}
        />
      ) : null}
    </div>
  );
}
