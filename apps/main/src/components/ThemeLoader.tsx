"use client";

import { useEffect } from "react";

export function ThemeLoader() {
  useEffect(() => {
    fetch("/api/design-tokens")
      .then((r) => r.json())
      .then((data) => {
        if (data && typeof data === "object") {
          const root = document.documentElement;
          const map: Record<string, string> = {
            primaryColor: "--color-primary",
            secondaryColor: "--color-secondary",
            backgroundColor: "--color-background",
            textColor: "--color-text",
            headingColor: "--color-heading",
            linkColor: "--color-link",
            buttonColor: "--color-button",
            buttonTextColor: "--color-button-text",
            buttonHoverColor: "--color-button-hover",
            buttonHoverTextColor: "--color-button-hover-text",
            headingFont: "--font-heading",
            bodyFont: "--font-body",
            headingFontSize: "--font-size-heading",
            bodyFontSize: "--font-size-body",
            lineHeight: "--line-height",
            letterSpacing: "--letter-spacing",
            buttonBorderRadius: "--button-border-radius",
            buttonPadding: "--button-padding",
            sectionPadding: "--section-padding",
            columnGap: "--column-gap",
            maxWidth: "--max-width",
            sectionAltColor: "--color-section-alt",
          };
          Object.entries(data).forEach(([key, value]) => {
            const cssVar = map[key];
            if (cssVar && typeof value === "string") root.style.setProperty(cssVar, value);
          });
        }
      })
      .catch(() => {});
  }, []);
  return null;
}
