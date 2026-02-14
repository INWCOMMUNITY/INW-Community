"use client";

import { useState, useCallback, useRef } from "react";
import Image from "next/image";

interface BusinessPhotoGalleryProps {
  photos: string[];
  alt?: string;
  size?: "default" | "large";
}

export function BusinessPhotoGallery({ photos, alt = "Business photo", size = "default" }: BusinessPhotoGalleryProps) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const touchStartX = useRef<number>(0);

  const goNext = useCallback(() => {
    setCurrentIndex((i) => (i + 1) % photos.length);
  }, [photos.length]);

  const goPrev = useCallback(() => {
    setCurrentIndex((i) => (i - 1 + photos.length) % photos.length);
  }, [photos.length]);

  function handleTouchStart(e: React.TouchEvent) {
    if (e.touches.length === 0) return;
    touchStartX.current = e.touches[0].clientX;
  }

  function handleTouchEnd(e: React.TouchEvent) {
    if (e.changedTouches.length === 0) return;
    const delta = touchStartX.current - e.changedTouches[0].clientX;
    if (Math.abs(delta) > 50) {
      if (delta > 0) goNext();
      else goPrev();
    }
  }

  if (photos.length === 0) return null;

  return (
    <>
      <div
        className={
          size === "large"
            ? "grid grid-cols-1 sm:grid-cols-2 gap-4"
            : "grid grid-cols-2 md:grid-cols-3 gap-2"
        }
      >
        {photos.map((url, i) => (
          <button
            key={i}
            type="button"
            onClick={() => {
              setCurrentIndex(i);
              setLightboxOpen(true);
            }}
            className={
              size === "large"
                ? "block w-full aspect-square min-h-[200px] sm:min-h-[280px] rounded-lg overflow-hidden border-2 hover:opacity-90 transition relative"
                : "block w-full aspect-square rounded-lg overflow-hidden border hover:opacity-90 transition relative"
            }
            style={size === "large" ? { borderColor: "var(--color-primary)" } : undefined}
          >
            <Image
              src={url}
              alt={`${alt} ${i + 1}`}
              fill
              sizes={size === "large" ? "(min-width: 640px) 400px, 100vw" : "(min-width: 768px) 350px, 50vw"}
              className="object-cover"
              quality={95}
              unoptimized={url.startsWith("blob:")}
            />
          </button>
        ))}
      </div>

      {lightboxOpen && (
        <div
          className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center"
          onClick={() => setLightboxOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Photo gallery"
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setLightboxOpen(false);
            }}
            className="absolute top-4 right-4 text-white text-2xl hover:opacity-80"
            aria-label="Close"
          >
            ✕
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              goPrev();
            }}
            className="absolute left-4 top-1/2 -translate-y-1/2 text-white text-4xl hover:opacity-80 px-2"
            aria-label="Previous photo"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              goNext();
            }}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-white text-4xl hover:opacity-80 px-2"
            aria-label="Next photo"
          >
            ›
          </button>
          <div
            className="relative w-[95vw] h-[95vh] max-w-[1800px] max-h-[95vh] flex items-center justify-center"
            onClick={(e) => e.stopPropagation()}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
          >
            <Image
              key={currentIndex}
              src={photos[currentIndex]}
              alt={`${alt} ${currentIndex + 1}`}
              fill
              sizes="95vw"
              className="object-contain select-none cursor-pointer"
              quality={100}
              unoptimized={photos[currentIndex].startsWith("blob:")}
              onClick={goNext}
              draggable={false}
            />
          </div>
          <p className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white text-sm">
            {currentIndex + 1} / {photos.length}
          </p>
        </div>
      )}
    </>
  );
}
