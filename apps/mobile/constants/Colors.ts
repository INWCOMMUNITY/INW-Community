import { theme } from "@/lib/theme";

const tintColorLight = theme.colors.primary;
const tintColorDark = theme.colors.cream;

export default {
  light: {
    text: theme.colors.text,
    background: theme.colors.background,
    tint: tintColorLight,
    tabIconDefault: theme.colors.tabIconInactive,
    tabIconSelected: "#ffffff",
    primary: theme.colors.primary,
    cream: theme.colors.cream,
  },
  dark: {
    text: theme.colors.text,
    background: "#ffffff",
    tint: tintColorDark,
    tabIconDefault: theme.colors.tabIconInactive,
    tabIconSelected: "#ffffff",
    primary: theme.colors.primary,
    cream: theme.colors.cream,
  },
};
