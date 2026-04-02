"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";

interface BusinessPhotoGalleryProps {
  photos: string[];
  alt?: string;
  size?: "default" | "large";
}

export function BusinessPhotoGallery({ photos, alt = "Business photo", size = "default" }: BusinessPhotoGalleryProps) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [portalReady, setPortalReady] = useState(false);
  const touchStartX = useRef<number>(0);

  useEffect(() => {
    setPortalReady(true);
  }, []);

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
              sizes={size === "large" ? "(min-width: 640px) 800px, 100vw" : "(min-width: 768px) 700px, 50vw"}
              className="object-cover"
              quality={95}
              unoptimized={url.startsWith("blob:")}
            />
          </button>
        ))}
      </div>

      {lightboxOpen &&
        portalReady &&
        createPortal(
          <div
            className="fixed inset-0 z-[200] flex items-center justify-center bg-black/90"
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
              className="absolute left-4 top-4 z-20 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-2xl text-white hover:bg-white/20 sm:left-auto sm:right-4"
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
              className="absolute left-2 top-[calc(50%+1.5rem)] z-10 -translate-y-1/2 px-2 text-4xl text-white hover:opacity-80 sm:left-4 sm:top-1/2"
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
              className="absolute right-2 top-[calc(50%+1.5rem)] z-10 -translate-y-1/2 px-2 text-4xl text-white hover:opacity-80 sm:right-4 sm:top-1/2"
              aria-label="Next photo"
            >
              ›
            </button>
            <div
              className="relative flex h-[95vh] w-[95vw] max-h-[95vh] max-w-[1800px] items-center justify-center pt-14 sm:pt-0"
              onClick={(e) => e.stopPropagation()}
              onTouchStart={handleTouchStart}
              onTouchEnd={handleTouchEnd}
            >
              <Image
                key={currentIndex}
                src={photos[currentIndex]}
                alt={`${alt} ${currentIndex + 1}`}
                fill
                sizes="(max-width: 1280px) 95vw, 1200px"
                className="cursor-pointer select-none object-contain"
                quality={100}
                unoptimized={photos[currentIndex].startsWith("blob:")}
                onClick={goNext}
                draggable={false}
              />
            </div>
            <p className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 text-sm text-white">
              {currentIndex + 1} / {photos.length}
            </p>
          </div>,
          document.body,
        )}
    </>
  );
}
