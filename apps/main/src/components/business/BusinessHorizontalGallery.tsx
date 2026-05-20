"use client";

import { useState, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { useLockBodyScroll } from "@/lib/scroll-lock";

type Props = {
  photos: string[];
  alt: string;
};

export function BusinessHorizontalGallery({ photos, alt }: Props) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [portalReady, setPortalReady] = useState(false);

  const urls = photos.filter(Boolean);

  useEffect(() => setPortalReady(true), []);
  useLockBodyScroll(lightboxOpen);

  const goNext = useCallback(() => {
    setIndex((i) => (i + 1) % urls.length);
  }, [urls.length]);

  const goPrev = useCallback(() => {
    setIndex((i) => (i - 1 + urls.length) % urls.length);
  }, [urls.length]);

  if (urls.length === 0) return null;

  return (
    <>
      <div
        className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1 scroll-smooth"
        style={{ scrollbarWidth: "thin" }}
      >
        {urls.map((url, i) => (
          <button
            key={`${url}-${i}`}
            type="button"
            onClick={() => {
              setIndex(i);
              setLightboxOpen(true);
            }}
            className="relative shrink-0 w-[280px] h-[220px] rounded-lg overflow-hidden bg-[#f5f5f5]"
          >
            <Image
              src={url}
              alt={`${alt} ${i + 1}`}
              fill
              className="object-cover"
              sizes="280px"
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
            aria-label="Business photos"
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setLightboxOpen(false);
              }}
              className="absolute right-4 top-4 z-20 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-2xl text-white hover:bg-white/20"
              aria-label="Close"
            >
              ✕
            </button>
            {urls.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    goPrev();
                  }}
                  className="absolute left-4 top-1/2 z-10 -translate-y-1/2 text-4xl text-white hover:opacity-80"
                  aria-label="Previous"
                >
                  ‹
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    goNext();
                  }}
                  className="absolute right-4 top-1/2 z-10 -translate-y-1/2 text-4xl text-white hover:opacity-80"
                  aria-label="Next"
                >
                  ›
                </button>
              </>
            )}
            <div className="relative h-[90vh] w-[92vw] max-w-5xl" onClick={(e) => e.stopPropagation()}>
              <Image
                src={urls[index]}
                alt={`${alt} ${index + 1}`}
                fill
                className="object-contain"
                sizes="92vw"
                unoptimized={urls[index].startsWith("blob:")}
              />
            </div>
            {urls.length > 1 && (
              <p className="absolute bottom-4 left-1/2 -translate-x-1/2 text-sm text-white">
                {index + 1} / {urls.length}
              </p>
            )}
          </div>,
          document.body
        )}
    </>
  );
}
