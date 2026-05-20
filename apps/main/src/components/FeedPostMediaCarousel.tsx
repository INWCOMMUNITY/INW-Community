"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IonIcon } from "@/components/IonIcon";

const TRACK_SCROLLBAR_HIDE =
  "overflow-y-hidden [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden";

export type FeedCarouselMediaItem = {
  url: string;
  isVideo: boolean;
};

type IntrinsicSize = { width: number; height: number } | null;

const FALLBACK_ASPECT = 1 / 1.38;

function scaledHeight(
  intrinsic: IntrinsicSize,
  containerW: number,
  maxH: number
): number {
  if (containerW <= 0) return Math.round(containerW / FALLBACK_ASPECT);
  const iw = intrinsic?.width && intrinsic.width > 0 ? intrinsic.width : containerW;
  const ih =
    intrinsic?.height && intrinsic.height > 0
      ? intrinsic.height
      : Math.max(1, Math.round(iw / FALLBACK_ASPECT));
  const scale = Math.min(containerW / iw, maxH / ih);
  return Math.max(1, Math.round(ih * scale));
}

interface FeedPostMediaCarouselProps {
  items: FeedCarouselMediaItem[];
  onOpenItem?: (index: number) => void;
  /** When set, each slide links to this href (e.g. shared post original). */
  slideHref?: string;
  className?: string;
}

export function FeedPostMediaCarousel({
  items,
  onOpenItem,
  slideHref,
  className = "",
}: FeedPostMediaCarouselProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [containerW, setContainerW] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [intrinsics, setIntrinsics] = useState<IntrinsicSize[]>(() =>
    items.map(() => null)
  );

  const mediaSig = items.map((m) => `${m.isVideo ? "v" : "p"}:${m.url}`).join("\u0001");

  useEffect(() => {
    setActiveIndex(0);
    setIntrinsics(items.map(() => null));
  }, [mediaSig, items.length]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const w = Math.round(el.getBoundingClientRect().width);
      if (w > 0) setContainerW(w);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const maxCarouselH = useMemo(() => {
    if (typeof window === "undefined") return 560;
    return Math.round(window.innerHeight * 0.62);
  }, []);

  const setIntrinsicAt = useCallback((index: number, size: { width: number; height: number }) => {
    setIntrinsics((prev) => {
      const next = prev.length === items.length ? [...prev] : items.map(() => null);
      const cur = next[index];
      if (cur && cur.width === size.width && cur.height === size.height) return prev;
      next[index] = size;
      return next;
    });
  }, [items.length]);

  const carouselH = useMemo(() => {
    if (containerW <= 0 || items.length === 0) {
      return Math.min(Math.round((containerW || 320) / FALLBACK_ASPECT), maxCarouselH);
    }
    const heights = items.map((item, i) => {
      const intrinsic = intrinsics[i];
      if (item.isVideo && intrinsic) {
        return scaledHeight(intrinsic, containerW, maxCarouselH);
      }
      if (item.isVideo) {
        return Math.min(Math.round((containerW * 16) / 9), maxCarouselH);
      }
      return scaledHeight(intrinsic, containerW, maxCarouselH);
    });
    return Math.min(Math.max(...heights, 1), maxCarouselH);
  }, [containerW, items, intrinsics, maxCarouselH]);

  const handleScroll = useCallback(() => {
    const el = trackRef.current;
    if (!el || containerW <= 0) return;
    const index = Math.round(el.scrollLeft / containerW);
    setActiveIndex(Math.min(Math.max(0, index), items.length - 1));
  }, [containerW, items.length]);

  const scrollToIndex = useCallback(
    (index: number) => {
      const el = trackRef.current;
      if (!el || containerW <= 0) return;
      const next = Math.min(Math.max(0, index), items.length - 1);
      el.scrollTo({ left: next * containerW, behavior: "smooth" });
      setActiveIndex(next);
    },
    [containerW, items.length]
  );

  const hasPrev = activeIndex > 0;
  const hasNext = activeIndex < items.length - 1;
  const showNav = items.length > 1;

  if (items.length === 0) return null;

  const slideInner = (item: FeedCarouselMediaItem, index: number) => (
    <>
      {item.isVideo ? (
        <video
          src={item.url}
          className="w-full h-full object-contain bg-neutral-900 pointer-events-none"
          muted
          playsInline
          preload="metadata"
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            if (v.videoWidth > 0 && v.videoHeight > 0) {
              setIntrinsicAt(index, { width: v.videoWidth, height: v.videoHeight });
            }
          }}
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.url}
          alt=""
          className="w-full h-full object-contain bg-neutral-100 select-none"
          draggable={false}
          onLoad={(e) => {
            const img = e.currentTarget;
            if (img.naturalWidth > 0 && img.naturalHeight > 0) {
              setIntrinsicAt(index, {
                width: img.naturalWidth,
                height: img.naturalHeight,
              });
            }
          }}
        />
      )}
    </>
  );

  const navBtnClass =
    "absolute top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/30 bg-black/45 text-white shadow-md transition hover:bg-black/60 disabled:pointer-events-none disabled:opacity-30";

  return (
    <div ref={containerRef} className={`w-full ${className}`}>
      <div className="relative max-w-full rounded border border-gray-200 bg-black/5 overflow-hidden">
        {showNav && (
          <>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                scrollToIndex(activeIndex - 1);
              }}
              disabled={!hasPrev}
              className={`${navBtnClass} left-2`}
              aria-label="Previous photo"
            >
              <IonIcon name="chevron-back" size={22} />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                scrollToIndex(activeIndex + 1);
              }}
              disabled={!hasNext}
              className={`${navBtnClass} right-2`}
              aria-label="Next photo"
            >
              <IonIcon name="chevron-forward" size={22} />
            </button>
          </>
        )}
        <div
          ref={trackRef}
          data-feed-carousel-track
          className={`flex snap-x snap-mandatory scroll-smooth max-w-full overflow-x-auto ${TRACK_SCROLLBAR_HIDE}`}
          style={{ height: carouselH > 0 ? carouselH : undefined, minHeight: containerW > 0 ? undefined : 200 }}
          onScroll={handleScroll}
        >
        {items.map((item, i) => {
          const slideClass =
            "snap-center shrink-0 w-full min-w-full relative flex items-center justify-center overflow-hidden bg-neutral-100 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]";
          const style = { height: carouselH > 0 ? carouselH : 200 };

          if (slideHref) {
            return (
              <a
                key={`${item.url}-${i}`}
                href={slideHref}
                className={slideClass}
                style={style}
                aria-label={`Media ${i + 1} — view original post`}
              >
                {slideInner(item, i)}
              </a>
            );
          }

          if (onOpenItem) {
            return (
              <button
                key={`${item.url}-${i}`}
                type="button"
                onClick={() => onOpenItem(i)}
                className={`${slideClass} cursor-zoom-in`}
                style={style}
                aria-label={`Open media ${i + 1} of ${items.length}`}
              >
                {slideInner(item, i)}
              </button>
            );
          }

          return (
            <div key={`${item.url}-${i}`} className={slideClass} style={style} role="img" aria-label={`Media ${i + 1}`}>
              {slideInner(item, i)}
            </div>
          );
        })}
        </div>
      </div>
      {items.length > 1 && (
        <div className="flex justify-center gap-1.5 mt-2" aria-hidden>
          {items.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all ${
                i === activeIndex ? "w-4 bg-[var(--color-primary)]" : "w-1.5 bg-gray-300"
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
