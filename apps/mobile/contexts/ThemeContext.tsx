"use client";

import React, { createContext, useContext, useEffect, useState, useMemo } from "react";
import { apiGet } from "@/lib/api";
import {
  theme as defaultTheme,
  mapDesignTokensToTheme,
  resolveTheme,
  type AppTheme,
} from "@/lib/theme";

export type { AppTheme };

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
  return resolveTheme(ctx ?? defaultTheme);
}
