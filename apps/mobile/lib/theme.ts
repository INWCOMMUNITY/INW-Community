/**
 * Northwest Community design tokens.
 * Default values - app fetches live tokens from /api/design-tokens for sync with website.
 * Use useTheme() from @/contexts/ThemeContext for synced theme in new components.
 */

export type AppTheme = {
  colors: {
    primary: string;
    secondary: string;
    background: string;
    text: string;
    heading: string;
    cream: string;
    creamAlt: string;
    /** Warm tan behind feeds and browse screens. */
    feedBackground: string;
    /** Unified page tint for tab screens. */
    pageBackground: string;
    buttonText: string;
    onPrimary: string;
    tabIconInactive: string;
    placeholder: string;
    labelMuted: string;
    gold: string;
    /** Website `--color-earth` brown. */
    earth: string;
    border: string;
    borderMuted: string;
    surface: string;
    surfacePressed: string;
    cardImageWell: string;
    menuRowText: string;
  };
  fonts: {
    heading: string;
    headingRegular: string;
    body: string;
  };
  radii: {
    button: number;
    card: number;
    chip: number;
    input: number;
    badge: number;
  };
  spacing: {
    xs: number;
    sm: number;
    md: number;
    lg: number;
    xl: number;
    xxl: number;
  };
  shadows: {
    card: {
      shadowColor: string;
      shadowOffset: { width: number; height: number };
      shadowOpacity: number;
      shadowRadius: number;
      elevation: number;
    };
  };
};

export const theme: AppTheme = {
  colors: {
    primary: "#505542",
    secondary: "#3E432F",
    background: "#ffffff",
    text: "#505542",
    heading: "#3E432F",
    cream: "#FDEDCC",
    creamAlt: "#FFF8E1",
    feedBackground: "#f6f1eb",
    pageBackground: "#f6f1eb",
    buttonText: "#ffffff",
    onPrimary: "#ffffff",
    tabIconInactive: "#999",
    placeholder: "#888888",
    labelMuted: "#999",
    gold: "#c99d5f",
    earth: "#5d4f40",
    border: "#e0e0e0",
    borderMuted: "#eee",
    surface: "#ffffff",
    surfacePressed: "#f5f5f5",
    cardImageWell: "#F8F8F3",
    menuRowText: "#444444",
  },
  fonts: {
    heading: "Fahkwang_700Bold",
    headingRegular: "Fahkwang_400Regular",
    body: "Helvetica Neue",
  },
  radii: {
    button: 8,
    card: 12,
    chip: 20,
    input: 8,
    badge: 12,
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 20,
    xxl: 24,
  },
  shadows: {
    card: {
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.1,
      shadowRadius: 4,
      elevation: 3,
    },
  },
};

function parseRadius(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Always return a full theme so new token fields cannot crash older in-memory context. */
export function resolveTheme(partial?: Partial<AppTheme> | null): AppTheme {
  if (!partial) return theme;
  return {
    ...theme,
    ...partial,
    colors: { ...theme.colors, ...partial.colors },
    fonts: { ...theme.fonts, ...partial.fonts },
    radii: { ...theme.radii, ...partial.radii },
    spacing: { ...theme.spacing, ...partial.spacing },
    shadows: {
      card: { ...theme.shadows.card, ...partial.shadows?.card },
    },
  };
}

/** Map API design token keys onto the mobile theme without dropping local fields. */
export function mapDesignTokensToTheme(
  tokens: Record<string, string>,
  base: AppTheme = theme
): AppTheme {
  const feedBackground =
    tokens.feedBackgroundColor ?? tokens.sectionAltColor ?? base.colors.feedBackground;
  return {
    ...base,
    colors: {
      ...base.colors,
      primary: tokens.primaryColor ?? tokens.buttonColor ?? base.colors.primary,
      secondary: tokens.secondaryColor ?? base.colors.secondary,
      background: tokens.backgroundColor ?? base.colors.background,
      text: tokens.textColor ?? base.colors.text,
      heading: tokens.headingColor ?? base.colors.heading,
      cream: tokens.buttonHoverColor ?? tokens.sectionAltColor ?? base.colors.cream,
      creamAlt: tokens.sectionAltColor ?? tokens.buttonHoverColor ?? base.colors.creamAlt,
      feedBackground,
      pageBackground: tokens.pageBackgroundColor ?? feedBackground,
      buttonText: tokens.buttonTextColor ?? base.colors.buttonText,
      onPrimary: tokens.buttonTextColor ?? base.colors.onPrimary,
      placeholder: tokens.placeholderColor ?? base.colors.placeholder,
      gold: tokens.goldColor ?? tokens.accentColor ?? base.colors.gold,
      earth: tokens.earthColor ?? base.colors.earth,
    },
    radii: {
      ...base.radii,
      button: parseRadius(tokens.buttonBorderRadius, base.radii.button),
    },
  };
}

/** RN Switch: off = tan (cream), on = theme green (primary). */
export function switchTrackColor() {
  return { false: theme.colors.cream, true: theme.colors.primary } as const;
}

export function switchThumbColor(value: boolean) {
  return value ? theme.colors.buttonText : "#f4f3f4";
}

export const switchIosBackgroundColor = theme.colors.cream;

/** White ring around the age-confirmation Switch so it does not blend into green signup form backgrounds. */
export const signupAgeSwitchOutline = {
  borderWidth: 2,
  borderColor: "#ffffff",
  borderRadius: 20,
  padding: 3,
  alignSelf: "flex-start" as const,
};
