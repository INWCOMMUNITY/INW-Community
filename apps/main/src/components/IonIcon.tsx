"use client";

import React from "react";

const IONICON_CDN = "https://unpkg.com/ionicons@7.1.0/dist/svg";

/**
 * Renders an Ionicons icon via CSS mask (same icon set as the mobile app).
 * Use for hub pages to match app layout. Inherits color from parent or use className.
 */
export function IonIcon({
  name,
  size = 28,
  className = "",
  style = {},
}: {
  name: string;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const url = `${IONICON_CDN}/${name}.svg`;
  return (
    <span
      role="img"
      aria-hidden
      className={className}
      style={{
        display: "inline-block",
        width: size,
        height: size,
        backgroundColor: "currentColor",
        WebkitMaskImage: `url(${url})`,
        maskImage: `url(${url})`,
        WebkitMaskSize: "contain",
        maskSize: "contain",
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        maskPosition: "center",
        flexShrink: 0,
        ...style,
      }}
    />
  );
}
