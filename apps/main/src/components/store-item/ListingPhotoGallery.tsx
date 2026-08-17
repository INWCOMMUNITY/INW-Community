"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { IonIcon } from "@/components/IonIcon";
import { listingHintClass } from "./listing-form-styles";

type ListingPhotoGalleryProps = {
  photos: string[];
  onPhotosChange: (photos: string[]) => void;
  onUploadFiles: (files: File[]) => Promise<void>;
  uploadingPhotos: boolean;
  showSyncHint?: boolean;
};

export function ListingPhotoGallery({
  photos,
  onPhotosChange,
  onUploadFiles,
  uploadingPhotos,
  showSyncHint,
}: ListingPhotoGalleryProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const thumbScrollRef = useRef<HTMLDivElement>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverZone, setDragOverZone] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    setSelectedIndex((i) => (photos.length === 0 ? 0 : Math.min(i, photos.length - 1)));
  }, [photos.length]);

  useEffect(() => {
    const el = thumbScrollRef.current;
    if (!el) return;
    const thumb = el.children[selectedIndex] as HTMLElement | undefined;
    thumb?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [selectedIndex]);

  const goNext = useCallback(() => {
    if (photos.length <= 1) return;
    setSelectedIndex((i) => (i + 1) % photos.length);
  }, [photos.length]);

  const goPrev = useCallback(() => {
    if (photos.length <= 1) return;
    setSelectedIndex((i) => (i - 1 + photos.length) % photos.length);
  }, [photos.length]);

  const selectPhoto = useCallback((index: number) => {
    setSelectedIndex(index);
  }, []);

  const movePhoto = useCallback(
    (from: number, to: number) => {
      onPhotosChange(
        (() => {
          const next = [...photos];
          const [removed] = next.splice(from, 1);
          next.splice(to, 0, removed);
          return next;
        })()
      );
      setSelectedIndex((i) => {
        if (i === from) return to;
        if (from < i && to >= i) return i - 1;
        if (from > i && to <= i) return i + 1;
        return i;
      });
    },
    [photos, onPhotosChange]
  );

  function removePhoto(i: number) {
    onPhotosChange(photos.filter((_, idx) => idx !== i));
    setSelectedIndex((current) => {
      if (i < current) return current - 1;
      if (i === current) return Math.max(0, current - 1);
      return current;
    });
  }

  async function handleFiles(fileList: FileList | File[] | null) {
    if (!fileList?.length) return;
    await onUploadFiles(Array.from(fileList));
  }

  function scrollThumbnails(direction: "prev" | "next") {
    const el = thumbScrollRef.current;
    if (!el) return;
    const amount = Math.max(120, el.clientWidth * 0.75);
    el.scrollBy({ left: direction === "next" ? amount : -amount, behavior: "smooth" });
  }

  const hasMultiple = photos.length > 1;
  const currentPhoto = photos[selectedIndex];

  return (
    <div className="space-y-3">
      {photos.length > 0 && currentPhoto ? (
        <div className="relative w-full aspect-square max-h-80 bg-gray-50 rounded-xl overflow-hidden border border-gray-200">
          <img
            src={currentPhoto}
            alt={`Listing photo ${selectedIndex + 1}`}
            className="w-full h-full object-contain"
          />

          {hasMultiple ? (
            <>
              <button
                type="button"
                onClick={goPrev}
                className="absolute left-2 top-1/2 -translate-y-1/2 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-black/45 text-white hover:bg-black/60 transition-colors"
                aria-label="Previous photo"
              >
                <IonIcon name="chevron-back" size={20} className="text-white" />
              </button>
              <button
                type="button"
                onClick={goNext}
                className="absolute right-2 top-1/2 -translate-y-1/2 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-black/45 text-white hover:bg-black/60 transition-colors"
                aria-label="Next photo"
              >
                <IonIcon name="chevron-forward" size={20} className="text-white" />
              </button>
              <span className="absolute bottom-2 right-2 z-10 rounded-full bg-black/50 px-2 py-0.5 text-[11px] font-medium text-white">
                {selectedIndex + 1} / {photos.length}
              </span>
            </>
          ) : null}

          {selectedIndex === 0 ? (
            <span className="absolute top-2 left-2 z-10 rounded-full bg-black/50 px-2 py-0.5 text-[10px] font-medium text-white">
              Main
            </span>
          ) : null}
        </div>
      ) : null}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOverZone(true);
        }}
        onDragLeave={() => setDragOverZone(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOverZone(false);
          void handleFiles(e.dataTransfer.files);
        }}
        className={`rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
          dragOverZone
            ? "border-[var(--color-primary)] bg-[var(--color-primary)]/5"
            : "border-gray-300 bg-gray-50/50 hover:border-gray-400"
        }`}
      >
        <p className="text-sm font-medium text-gray-800 mb-1">
          {photos.length > 0 ? "Add more photos" : "Add photos"}
        </p>
        <p className="text-xs text-gray-500 mb-3">Drag and drop or choose from your device</p>
        <label className="inline-block cursor-pointer">
          <span className="action-pill action-pill-sm btn-pill-primary">
            {uploadingPhotos ? "Uploading…" : "Choose photos"}
          </span>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            disabled={uploadingPhotos}
            onChange={(e) => {
              void handleFiles(e.target.files);
              e.target.value = "";
            }}
            className="sr-only"
          />
        </label>
      </div>

      {photos.length > 0 ? (
        <>
          <div className="relative">
            {photos.length > 4 ? (
              <button
                type="button"
                onClick={() => scrollThumbnails("prev")}
                className="absolute left-0 top-1/2 -translate-y-1/2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white border border-gray-200 shadow-sm hover:bg-gray-50"
                aria-label="Scroll thumbnails left"
              >
                <IonIcon name="chevron-back" size={18} className="text-gray-700" />
              </button>
            ) : null}
            <div
              ref={thumbScrollRef}
              className={`flex gap-2 overflow-x-auto pb-1 scroll-smooth ${photos.length > 4 ? "px-9" : ""}`}
              style={{ scrollbarWidth: "thin" }}
            >
              {photos.map((url, i) => (
                <div
                  key={`${url}-${i}`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const fromIndex = parseInt(e.dataTransfer.getData("text/plain"), 10);
                    if (!isNaN(fromIndex) && fromIndex !== i) movePhoto(fromIndex, i);
                    setDragIndex(null);
                  }}
                  className={`relative shrink-0 w-20 h-20 rounded-lg border-2 overflow-hidden ${
                    dragIndex === i ? "border-[var(--color-primary)] opacity-60" : "border-gray-200"
                  } ${i === selectedIndex ? "ring-2 ring-[var(--color-primary)]" : ""}`}
                >
                  <button
                    type="button"
                    onClick={() => selectPhoto(i)}
                    className="absolute inset-0 z-[1] w-full h-full cursor-pointer"
                    aria-label={`Show photo ${i + 1} in preview`}
                    aria-pressed={i === selectedIndex}
                  >
                    <img src={url} alt="" className="w-full h-full object-cover pointer-events-none" draggable={false} />
                  </button>
                  {i === 0 ? (
                    <span className="absolute bottom-0 inset-x-0 z-[2] bg-black/60 text-white text-[10px] text-center py-0.5 pointer-events-none">
                      Main
                    </span>
                  ) : null}
                  <div
                    draggable
                    onDragStart={(e) => {
                      setDragIndex(i);
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", String(i));
                      const img = e.currentTarget.parentElement?.querySelector("img");
                      if (img instanceof HTMLImageElement) {
                        e.dataTransfer.setDragImage(img, 40, 40);
                      }
                    }}
                    onDragEnd={() => setDragIndex(null)}
                    onMouseDown={(e) => e.stopPropagation()}
                    className="absolute top-0.5 left-0.5 z-[3] flex h-5 w-5 items-center justify-center rounded bg-black/50 text-white cursor-grab active:cursor-grabbing"
                    aria-label="Drag to reorder"
                    title="Drag to reorder"
                    role="button"
                    tabIndex={0}
                  >
                    <IonIcon name="reorder-three" size={14} className="text-white" />
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      removePhoto(i);
                    }}
                    className="absolute top-0.5 right-0.5 z-[3] w-5 h-5 bg-red-500 text-white rounded-full text-xs leading-none hover:bg-red-600"
                    aria-label="Remove photo"
                  >
                    ×
                  </button>
                </div>
              ))}
              {uploadingPhotos ? (
                <div className="shrink-0 w-20 h-20 rounded-lg border-2 border-dashed border-gray-300 flex items-center justify-center">
                  <span className="w-6 h-6 border-2 border-gray-300 border-t-[var(--color-primary)] rounded-full animate-spin" />
                </div>
              ) : null}
            </div>
            {photos.length > 4 ? (
              <button
                type="button"
                onClick={() => scrollThumbnails("next")}
                className="absolute right-0 top-1/2 -translate-y-1/2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white border border-gray-200 shadow-sm hover:bg-gray-50"
                aria-label="Scroll thumbnails right"
              >
                <IonIcon name="chevron-forward" size={18} className="text-gray-700" />
              </button>
            ) : null}
          </div>
          <p className={listingHintClass}>
            Click a thumbnail to show it in the preview above. Use the side arrows to browse. Drag the
            grip icon to reorder — first image is the main photo.
          </p>
        </>
      ) : null}

      {showSyncHint ? (
        <p className="text-xs text-[var(--color-primary)]/80">Photos push to connected stores when you save.</p>
      ) : null}
    </div>
  );
}
