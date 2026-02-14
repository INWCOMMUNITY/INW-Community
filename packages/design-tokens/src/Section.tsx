"use client";

import React from "react";

export interface SectionProps {
  id?: string;
  className?: string;
  style?: React.CSSProperties;
  columns: React.ReactNode[];
  layout?: "single" | "two-col" | "custom";
  height?: string;
  altBackground?: boolean;
}

export function Section({ id, className, style, columns, layout = "two-col", height, altBackground }: SectionProps) {
  const isTwoCol = layout === "two-col" && columns.length >= 2;
  return (
    <section
      id={id}
      className={className}
      style={{
        padding: "var(--section-padding, 3rem 1.5rem)",
        maxWidth: "var(--max-width, 1200px)",
        margin: "0 auto",
        minHeight: height,
        ...(altBackground && { backgroundColor: "var(--color-section-alt)" }),
        ...style,
      }}
    >
      <div
        className={`grid grid-cols-1 gap-[var(--column-gap,2rem)] items-start ${isTwoCol ? "md:grid-cols-2" : ""}`}
        style={{ minWidth: 0 }}
      >
        {columns.map((col, i) => (
          <div key={i} className="min-w-0">
            {col}
          </div>
        ))}
      </div>
    </section>
  );
}
