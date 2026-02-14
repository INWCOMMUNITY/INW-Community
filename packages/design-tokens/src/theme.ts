// Default design tokens - editable from Admin
export interface DesignTheme {
  // Colors
  primaryColor: string;
  secondaryColor: string;
  backgroundColor: string;
  textColor: string;
  headingColor: string;
  linkColor: string;
  buttonColor: string;
  buttonTextColor: string;
  buttonHoverColor: string;
  buttonHoverTextColor: string;

  // Typography
  headingFont: string;
  bodyFont: string;
  headingFontSize: string;
  bodyFontSize: string;
  lineHeight: string;
  letterSpacing: string;

  // Buttons
  buttonBorderRadius: string;
  buttonPadding: string;

  // Layout
  sectionPadding: string;
  columnGap: string;
  maxWidth: string;
  sectionAltColor?: string;
}

export const defaultTheme: DesignTheme = {
  primaryColor: "#505542",
  secondaryColor: "#3E432F",
  backgroundColor: "#ffffff",
  textColor: "#505542",
  headingColor: "#3E432F",
  linkColor: "#505542",
  buttonColor: "#505542",
  buttonTextColor: "#ffffff",
  buttonHoverColor: "#FDEDCC",
  buttonHoverTextColor: "#505542",
  headingFont: "'Fahkwang', sans-serif",
  bodyFont: "'Helvetica Neue', Helvetica, Arial, sans-serif",
  headingFontSize: "2rem",
  bodyFontSize: "1rem",
  lineHeight: "1.6",
  letterSpacing: "0",
  buttonBorderRadius: "4px",
  buttonPadding: "0.75rem 1.5rem",
  sectionPadding: "3rem 1.5rem",
  columnGap: "2rem",
  maxWidth: "1200px",
  sectionAltColor: "#FDEDCC",
};

export function themeToCssVariables(theme: Partial<DesignTheme>): Record<string, string> {
  const t = { ...defaultTheme, ...theme };
  return {
    "--color-primary": t.primaryColor,
    "--color-secondary": t.secondaryColor,
    "--color-background": t.backgroundColor,
    "--color-text": t.textColor,
    "--color-heading": t.headingColor,
    "--color-link": t.linkColor,
    "--color-button": t.buttonColor,
    "--color-button-text": t.buttonTextColor,
    "--color-button-hover": t.buttonHoverColor,
    "--color-button-hover-text": t.buttonHoverTextColor,
    "--font-heading": t.headingFont,
    "--font-body": t.bodyFont,
    "--font-size-heading": t.headingFontSize,
    "--font-size-body": t.bodyFontSize,
    "--line-height": t.lineHeight,
    "--letter-spacing": t.letterSpacing,
    "--button-border-radius": t.buttonBorderRadius,
    "--button-padding": t.buttonPadding,
    "--section-padding": t.sectionPadding,
    "--column-gap": t.columnGap,
    "--max-width": t.maxWidth,
    "--color-section-alt": t.sectionAltColor ?? "#FDEDCC",
  };
}
