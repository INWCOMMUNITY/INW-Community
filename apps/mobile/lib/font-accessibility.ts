/**
 * iOS "Larger Text" / Android font scale inflate RN font sizes and break tight layouts
 * (tab labels, header pills, navigation titles). We cap scaling so the UI matches design.
 *
 * This does not remove iOS "Bold Text" entirely (UIKit may still adjust some native chrome);
 * we use explicit fontFamily tokens where possible to reduce synthetic bolding.
 *
 * Per-screen overrides: pass maxFontSizeMultiplier or allowFontScaling on Text/TextInput.
 */
import { Text, TextInput } from "react-native";

/** 1 = ignore system text-size scaling; increase slightly (e.g. 1.1) if you want partial Dynamic Type. */
export const APP_MAX_FONT_SIZE_MULTIPLIER = 1;

type WithDefaultProps = {
  defaultProps?: {
    maxFontSizeMultiplier?: number;
    allowFontScaling?: boolean;
  };
};

function patchTextComponent(
  Component: typeof Text | typeof TextInput,
  maxFontSizeMultiplier: number
) {
  const C = Component as unknown as WithDefaultProps;
  C.defaultProps = {
    ...C.defaultProps,
    maxFontSizeMultiplier,
    allowFontScaling: C.defaultProps?.allowFontScaling ?? true,
  };
}

patchTextComponent(Text, APP_MAX_FONT_SIZE_MULTIPLIER);
patchTextComponent(TextInput, APP_MAX_FONT_SIZE_MULTIPLIER);
