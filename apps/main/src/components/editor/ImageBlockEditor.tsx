"use client";

import { useState, useCallback } from "react";
import ReactCrop, { type Crop, centerCrop, makeAspectCrop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";

export interface StoredCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ImageBlockEditorProps {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  crop?: StoredCrop;
  onChange: (updates: { src?: string; alt?: string; width?: number; height?: number; crop?: StoredCrop }) => void;
  onUpload: (file: File) => Promise<string>;
  onClick?: (e: React.MouseEvent) => void;
}

function centerAspectCrop(mediaWidth: number, mediaHeight: number, aspect: number): Crop {
  return centerCrop(
    makeAspectCrop(
      {
        unit: "%",
        width: 90,
      },
      aspect,
      mediaWidth,
      mediaHeight
    ),
    mediaWidth,
    mediaHeight
  );
}

export function ImageBlockEditor({
  src,
  alt,
  width,
  height,
  crop,
  onChange,
  onUpload,
  onClick,
}: ImageBlockEditorProps) {
  const [cropModalOpen, setCropModalOpen] = useState(false);
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [cropState, setCropState] = useState<Crop | undefined>();
  const [imgRef, setImgRef] = useState<HTMLImageElement | null>(null);

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const url = await onUpload(file);
        onChange({ src: url });
      } catch (err) {
        console.error("Upload failed:", err);
      }
      e.target.value = "";
    },
    [onUpload, onChange]
  );

  const openCropModal = useCallback(() => {
    if (!src) return;
    setCropSrc(src);
    setCropState(undefined);
    setCropModalOpen(true);
  }, [src]);

  const onImageLoad = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      const img = e.currentTarget;
      setImgRef(img);
      setCropState(centerAspectCrop(img.naturalWidth, img.naturalHeight, img.naturalWidth / img.naturalHeight));
    },
    []
  );

  const applyCrop = useCallback(() => {
    if (!cropState || !imgRef || !cropSrc) {
      setCropModalOpen(false);
      return;
    }
    const { x, y, width: cw, height: ch } = cropState;
    const nw = imgRef.naturalWidth;
    const nh = imgRef.naturalHeight;
    let px: number;
    let py: number;
    let pw: number;
    let ph: number;
    if (cropState.unit === "%") {
      px = (nw * (x ?? 0)) / 100;
      py = (nh * (y ?? 0)) / 100;
      pw = (nw * (cw ?? 100)) / 100;
      ph = (nh * (ch ?? 100)) / 100;
    } else {
      px = x ?? 0;
      py = y ?? 0;
      pw = cw ?? nw;
      ph = ch ?? nh;
    }
    onChange({
      crop: { x: px, y: py, width: pw, height: ph },
    });
    setCropModalOpen(false);
  }, [cropState, imgRef, cropSrc, onChange]);

  const maxDisplaySize = 400;
  const cropWrapperStyle =
    crop && (crop.width || crop.height)
      ? (() => {
          const cw = crop.width || 1;
          const ch = crop.height || 1;
          const scale = Math.min(1, maxDisplaySize / Math.max(cw, ch));
          return {
            width: cw * scale,
            height: ch * scale,
            overflow: "hidden" as const,
          };
        })()
      : undefined;

  const cropImgStyle =
    crop && cropWrapperStyle
      ? (() => {
          const cw = crop.width || 1;
          const ch = crop.height || 1;
          const scale = Math.min(1, maxDisplaySize / Math.max(cw, ch));
          return {
            display: "block",
            transform: `translate(${-crop.x}px, ${-crop.y}px) scale(${scale})`,
            transformOrigin: "top left",
          };
        })()
      : undefined;

  return (
    <div className="space-y-2" onClick={onClick}>
      <div className="flex gap-2 flex-wrap">
        <input
          type="url"
          value={src}
          onChange={(e) => onChange({ src: e.target.value })}
          placeholder="Image URL"
          className="flex-1 min-w-0 border rounded px-2 py-1 text-sm"
        />
        <input
          type="text"
          value={alt}
          onChange={(e) => onChange({ alt: e.target.value })}
          placeholder="Alt text"
          className="w-32 border rounded px-2 py-1 text-sm"
        />
        <label className="border rounded px-2 py-1 text-sm cursor-pointer hover:bg-gray-100">
          Replace / Upload
          <input type="file" accept="image/*" className="hidden" onChange={handleFileSelect} />
        </label>
        <button type="button" onClick={openCropModal} disabled={!src} className="border rounded px-2 py-1 text-sm">
          Crop
        </button>
      </div>
      <div className="flex gap-2">
        <input
          type="number"
          value={width ?? ""}
          onChange={(e) => onChange({ width: e.target.value ? parseInt(e.target.value, 10) : undefined })}
          placeholder="Width"
          className="w-20 border rounded px-2 py-1 text-sm"
        />
        <input
          type="number"
          value={height ?? ""}
          onChange={(e) => onChange({ height: e.target.value ? parseInt(e.target.value, 10) : undefined })}
          placeholder="Height"
          className="w-20 border rounded px-2 py-1 text-sm"
        />
      </div>
      {src && (
        <div
          className="relative rounded border"
          style={cropWrapperStyle}
        >
          <img
            src={src}
            alt={alt || "Image"}
            className="max-w-full h-auto"
            style={{
              ...(width && !crop ? { width: `${width}px` } : {}),
              ...(height && !crop ? { height: `${height}px` } : {}),
              ...cropImgStyle,
            }}
          />
        </div>
      )}
      {cropModalOpen && cropSrc && (
        <div className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg max-w-4xl max-h-[90vh] overflow-auto">
            <div className="p-4">
              <ReactCrop
                crop={cropState}
                onChange={(_, c) => setCropState(c)}
                aspect={undefined}
                className="max-w-full"
              >
                <img src={cropSrc} alt="" onLoad={onImageLoad} className="max-w-full h-auto" />
              </ReactCrop>
            </div>
            <div className="flex gap-2 p-4 border-t">
              <button type="button" onClick={applyCrop} className="btn">
                Apply crop
              </button>
              <button type="button" onClick={() => setCropModalOpen(false)} className="border rounded px-4 py-2">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
