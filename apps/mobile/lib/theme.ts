/**
 * Northwest Community design tokens.
 * Default values - app fetches live tokens from /api/design-tokens for sync with website.
 * Use useTheme() from @/contexts/ThemeContext for synced theme in new components.
 */
export const theme = {
  colors: {
    primary: "#505542",
    secondary: "#3E432F",
    background: "#ffffff",
    text: "#505542",
    heading: "#3E432F",
    cream: "#FDEDCC",
    creamAlt: "#FFF8E1",
    buttonText: "#ffffff",
    tabIconInactive: "#999",
    placeholder: "#888888",
    labelMuted: "#999",
  },
  fonts: {
    heading: "Fahkwang_700Bold",
    headingRegular: "Fahkwang_400Regular",
    body: "Helvetica Neue",
  },
} as const;

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
