"use client";

import Link from "next/link";
import { Section } from "design-tokens";
import type { PageStructure, ContentBlock, BlockStyles } from "types";
import { sanitizeHtml } from "@/lib/sanitize";

function getBlockStyles(block: ContentBlock): React.CSSProperties {
  const styles = (block.content?.styles as Partial<BlockStyles>) ?? {};
  const s: React.CSSProperties = {};
  if (styles.fontSize) s.fontSize = styles.fontSize;
  if (styles.fontFamily) s.fontFamily = styles.fontFamily;
  if (styles.color) s.color = styles.color;
  if (styles.backgroundColor) s.backgroundColor = styles.backgroundColor;
  if (styles.borderWidth) s.borderWidth = styles.borderWidth;
  if (styles.borderColor) s.borderColor = styles.borderColor;
  if (styles.borderRadius) s.borderRadius = styles.borderRadius;
  if (styles.textAlign) s.textAlign = styles.textAlign;
  return s;
}

function BlockContent({ block }: { block: ContentBlock }) {
  const content = block.content as Record<string, string>;
  const styles = getBlockStyles(block);
  const blockStyles = (block.content?.styles as Partial<BlockStyles>) ?? {};
  const pos = block.position;
  const hasPosition = pos && (pos.x !== undefined || pos.y !== undefined);
  const positionStyle: React.CSSProperties = hasPosition
    ? {
        position: "absolute",
        left: pos?.x ?? 0,
        top: pos?.y ?? 0,
        width: pos?.width,
        height: pos?.height,
        zIndex: block.zIndex ?? 0,
      }
    : {};

  const wrapper = (children: React.ReactNode) => (
    <div style={{ ...styles, ...positionStyle, minWidth: hasPosition ? 80 : undefined }}>{children}</div>
  );

  switch (block.type) {
    case "heading":
      return wrapper(
        <div
          dangerouslySetInnerHTML={{
            __html: sanitizeHtml((content.html ?? content.text ?? "<h2>Heading</h2>") as string),
          }}
          className="prose prose-lg max-w-none [&_h1]:text-3xl [&_h2]:text-2xl [&_h3]:text-xl"
        />
      );
    case "paragraph":
      return wrapper(
        <div
          dangerouslySetInnerHTML={{
            __html: sanitizeHtml((content.html ?? content.text ?? "<p></p>") as string),
          }}
          className="prose max-w-none [&_p]:mb-2"
        />
      );
    case "image":
      if (!content.src) return null;
      const crop = content.crop as unknown as { x: number; y: number; width: number; height: number } | undefined;
      if (crop && (crop.width || crop.height)) {
        return wrapper(
          <div style={{ width: crop.width, height: crop.height, overflow: "hidden" }}>
            <img
              src={content.src}
              alt={(content.alt as string) ?? ""}
              className="rounded"
              style={{
                display: "block",
                marginLeft: -crop.x,
                marginTop: -crop.y,
              }}
            />
          </div>
        );
      }
      return wrapper(
        <img
          src={content.src}
          alt={(content.alt as string) ?? ""}
          className="max-w-full h-auto rounded"
          style={{
            ...(content.width ? { width: `${content.width}px` } : {}),
            ...(content.height ? { height: `${content.height}px` } : {}),
          }}
        />
      );
    case "button": {
      const btnStyle: React.CSSProperties = {};
      if (blockStyles.hoverColor) {
        (btnStyle as Record<string, string>)["--hover-bg"] = blockStyles.hoverColor;
        if (blockStyles.hoverTextColor) (btnStyle as Record<string, string>)["--hover-text"] = blockStyles.hoverTextColor;
      }
      return wrapper(
        <Link href={(content.href as string) ?? "#"} className="btn inline-block" style={btnStyle}>
          {(content.text as string) ?? "Button"}
        </Link>
      );
    }
    case "link":
      return wrapper(
        <Link href={(content.href as string) ?? "#"} className="hover:underline" style={{ color: "var(--color-link)" }}>
          {(content.text as string) ?? "Link"}
        </Link>
      );
    case "video":
      if (!content.src) return <div className="text-gray-500 text-sm">Video (add URL)</div>;
      return wrapper(
        <div className="aspect-video">
          <iframe
            src={content.src}
            title={(content.title as string) ?? "Video"}
            className="w-full h-full rounded"
            allowFullScreen
          />
        </div>
      );
    case "line":
      return wrapper(<hr className="border-gray-300 my-4" />);
    case "box":
      return wrapper(
        <div className="border border-gray-300 rounded p-4 bg-gray-50">
          {(content.html ?? content.text) && (
            <div
              dangerouslySetInnerHTML={{
                __html: sanitizeHtml((content.html ?? content.text ?? "") as string),
              }}
              className="prose max-w-none"
            />
          )}
        </div>
      );
    default:
      return null;
  }
}

export function SiteContentRenderer({ structure }: { structure: PageStructure }) {
  if (!structure.sections?.length) return null;

  return (
    <>
      {structure.sections.map((section) => (
        <Section
          key={section.id}
          columns={section.columns.map((col) => (
            <div key={col.id} className="space-y-4 relative min-h-[40px]">
              {[...col.blocks]
                .sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))
                .map((block) => (
                  <BlockContent key={block.id} block={block} />
                ))}
            </div>
          ))}
          layout={section.layout === "two-col" ? "two-col" : "single"}
        />
      ))}
    </>
  );
}
