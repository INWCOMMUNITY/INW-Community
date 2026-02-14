"use client";

import { useState } from "react";

const HEADER_BG = "var(--color-secondary)";

export interface SlideItem {
  src: string;
  alt: string;
}

interface InfoPageSlideshowProps {
  /** When provided, shows these images. When omitted, shows a single placeholder (e.g. other info pages). */
  slides?: SlideItem[];
}

const PLACEHOLDER_SLIDES: SlideItem[] = [
  { src: "", alt: "Placeholder" },
];

export function InfoPageSlideshow({ slides: slidesProp }: InfoPageSlideshowProps) {
  const [index, setIndex] = useState(0);
  const slides = slidesProp?.length ? slidesProp : PLACEHOLDER_SLIDES;
  const SLIDE_COUNT = slides.length;
  const isPlaceholder = !slidesProp?.length;

  const goPrev = () => setIndex((i) => (i === 0 ? SLIDE_COUNT - 1 : i - 1));
  const goNext = () => setIndex((i) => (i === SLIDE_COUNT - 1 ? 0 : i + 1));

  const slide = slides[index];

  return (
    <section
      className="py-10 px-4 md:py-14"
      style={{
        padding: "var(--section-padding)",
        backgroundColor: HEADER_BG,
      }}
    >
      <div className="max-w-[var(--max-width)] mx-auto flex items-center gap-4 md:gap-6">
        <button
          type="button"
          onClick={goPrev}
          className="shrink-0 w-12 h-12 rounded-full flex items-center justify-center transition opacity-90 hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-white/50"
          style={{
            border: "2px solid #e8b86d",
            color: "#fff",
            backgroundColor: "transparent",
          }}
          aria-label="Previous slide"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>

        <div
          className="flex-1 min-w-0 rounded-xl overflow-hidden flex items-center justify-center"
          style={{
            backgroundColor: "#f5eedc",
            minHeight: "420px",
          }}
        >
          {slide && slide.src && !isPlaceholder ? (
            <>
              <img
                src={slide.src}
                alt={slide.alt}
                className="w-full h-full max-h-[420px] object-contain"
              />
              <p className="sr-only">Slide {index + 1} of {SLIDE_COUNT}</p>
            </>
          ) : (
            <>
              <p className="text-sm uppercase tracking-wider opacity-70 mb-2">Slide {index + 1} of {SLIDE_COUNT}</p>
              <p className="text-lg md:text-xl font-medium text-gray-700">
                Placeholder content for slide {index + 1}. We&apos;ll design this section later.
              </p>
            </>
          )}
        </div>

        <button
          type="button"
          onClick={goNext}
          className="shrink-0 w-12 h-12 rounded-full flex items-center justify-center transition opacity-90 hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-white/50"
          style={{
            border: "2px solid #e8b86d",
            color: "#fff",
            backgroundColor: "transparent",
          }}
          aria-label="Next slide"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
      </div>
      {SLIDE_COUNT > 1 && (
        <p className="text-center text-sm text-white/80 mt-2">
          {index + 1} of {SLIDE_COUNT}
        </p>
      )}
    </section>
  );
}
