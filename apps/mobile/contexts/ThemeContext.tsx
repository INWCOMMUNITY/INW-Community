"use client";

import React, { createContext, useContext, useEffect, useState, useMemo } from "react";
import { apiGet } from "@/lib/api";
import { theme as defaultTheme } from "@/lib/theme";

export type AppTheme = typeof defaultTheme;

/** Map API design token keys to our app theme structure */
function mapDesignTokensToTheme(tokens: Record<string, string>): AppTheme {
  return {
    colors: {
      primary: tokens.primaryColor ?? tokens.buttonColor ?? defaultTheme.colors.primary,
      secondary: tokens.secondaryColor ?? defaultTheme.colors.secondary,
      background: tokens.backgroundColor ?? defaultTheme.colors.background,
      text: tokens.textColor ?? defaultTheme.colors.text,
      heading: tokens.headingColor ?? defaultTheme.colors.heading,
      cream: tokens.buttonHoverColor ?? tokens.sectionAltColor ?? defaultTheme.colors.cream,
      creamAlt: tokens.sectionAltColor ?? tokens.buttonHoverColor ?? defaultTheme.colors.creamAlt,
      buttonText: tokens.buttonTextColor ?? defaultTheme.colors.buttonText,
      tabIconInactive: defaultTheme.colors.tabIconInactive,
      placeholder: tokens.placeholderColor ?? defaultTheme.colors.placeholder,
      labelMuted: defaultTheme.colors.labelMuted,
    },
    fonts: {
      heading: defaultTheme.fonts.heading,
      headingRegular: defaultTheme.fonts.headingRegular,
      body: defaultTheme.fonts.body,
    },
  };
}

const ThemeContext = createContext<AppTheme>(defaultTheme);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<AppTheme>(defaultTheme);

  useEffect(() => {
    apiGet<Record<string, string>>("/api/design-tokens")
      .then((data) => {
        if (data && typeof data === "object" && Object.keys(data).length > 0) {
          setTheme(mapDesignTokensToTheme(data));
        }
      })
      .catch(() => {
        /* Keep defaults on error */
      });
  }, []);

  const value = useMemo(() => theme, [theme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): AppTheme {
  const ctx = useContext(ThemeContext);
  return ctx ?? defaultTheme;
}
