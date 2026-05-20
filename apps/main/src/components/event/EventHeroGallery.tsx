"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { IonIcon } from "@/components/IonIcon";
import { HeartSaveButton } from "@/components/HeartSaveButton";
import { useLockBodyScroll } from "@/lib/scroll-lock";

type Props = {
  photos: string[];
  title: string;
  eventId: string;
  initialSaved: boolean;
  className?: string;
};

export function EventHeroGallery({ photos, title, eventId, initialSaved, className = "" }: Props) {
  const [index, setIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [portalReady, setPortalReady] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => setPortalReady(true), []);
  useLockBodyScroll(lightboxOpen);

  const urls = photos.filter(Boolean);

  const goNext = useCallback(() => {
    setIndex((i) => (i + 1) % urls.length);
  }, [urls.length]);

  const goPrev = useCallback(() => {
    setIndex((i) => (i - 1 + urls.length) % urls.length);
  }, [urls.length]);
  const hasMultiple = urls.length > 1;

  const scrollTo = useCallback((i: number) => {
    setIndex(i);
    const el = scrollRef.current;
    if (!el) return;
    const w = el.clientWidth;
    el.scrollTo({ left: i * w, behavior: "smooth" });
  }, []);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || el.clientWidth === 0) return;
    const i = Math.round(el.scrollLeft / el.clientWidth);
    setIndex(Math.max(0, Math.min(urls.length - 1, i)));
  }, [urls.length]);

  return (
    <div className={`w-full bg-[#f5f5f5] ${className}`.trim()}>
      <div className="relative w-full aspect-square max-h-[22rem] bg-[#f5f5f5] overflow-hidden">
        {urls.length > 1 ? (
          <>
            <div
              ref={scrollRef}
              onScroll={onScroll}
              className="flex w-full h-full overflow-x-auto snap-x snap-mandatory scroll-smooth"
              style={{ scrollbarWidth: "none" }}
            >
              {urls.map((url, i) => (
                <button
                  key={`${url}-${i}`}
                  type="button"
                  className="relative shrink-0 w-full h-full snap-center"
                  onClick={() => {
                    setIndex(i);
                    setLightboxOpen(true);
                  }}
                >
                  <Image src={url} alt={`${title} ${i + 1}`} fill className="object-cover" sizes="100vw" priority={i === 0} />
                </button>
              ))}
            </div>
            <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-1.5 pointer-events-none">
              {urls.map((_, i) => (
                <span
                  key={i}
                  className={`rounded-full bg-white transition-all ${
                    i === index ? "w-2 h-2 opacity-100" : "w-1.5 h-1.5 opacity-45"
                  }`}
                />
              ))}
            </div>
          </>
        ) : urls[0] ? (
          <button
            type="button"
            className="relative w-full h-full"
            onClick={() => setLightboxOpen(true)}
          >
            <Image src={urls[0]} alt={title} fill className="object-cover" sizes="100vw" priority />
          </button>
        ) : (
          <div
            className="flex flex-col items-center justify-center w-full h-full min-h-[10rem]"
            style={{ backgroundColor: "#FFF8E1" }}
          >
            <IonIcon name="calendar-outline" size={48} className="text-[var(--color-primary)]" />
            <p className="mt-1.5 text-sm" style={{ color: "var(--color-text)" }}>
              Event photo
            </p>
          </div>
        )}

        <div className="absolute top-3 right-3 z-10 rounded-full p-1.5" style={{ backgroundColor: "rgba(0,0,0,0.3)" }}>
          <HeartSaveButton
            type="event"
            referenceId={eventId}
            initialSaved={initialSaved}
            showWishlistToast={false}
            className="!w-9 !h-9"
          />
        </div>
      </div>

      {hasMultiple && (
        <div className="flex gap-2 overflow-x-auto px-0 py-2">
          {urls.map((url, i) => (
            <button
              key={`thumb-${i}`}
              type="button"
              onClick={() => scrollTo(i)}
              className={`relative shrink-0 w-16 h-16 rounded-lg overflow-hidden border-2 ${
                i === index ? "border-[var(--color-primary)]" : "border-transparent"
              }`}
            >
              <Image src={url} alt="" fill className="object-cover" sizes="64px" />
            </button>
          ))}
        </div>
      )}

      {lightboxOpen &&
        portalReady &&
        urls.length > 0 &&
        createPortal(
          <div
            className="fixed inset-0 z-[200] flex items-center justify-center bg-black/90"
            onClick={() => setLightboxOpen(false)}
            role="dialog"
            aria-modal="true"
            aria-label="Event photos"
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
                alt={`${title} ${index + 1}`}
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
    </div>
  );
}
