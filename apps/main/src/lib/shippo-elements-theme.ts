/**
 * Shippo Shipping Elements theme — matches site tokens (globals.css / design-tokens).
 * @see https://docs.goshippo.com/docs/shippingelements/customisation
 */

/** Compact iframe height (px). Shippo defaults to 600, which leaves empty white under Next. */
export const NWC_SHIPPO_IFRAME_HEIGHT_PX = 520;
/** Primary olive green */
const PRIMARY = "#505542";
/** Darker green (headings) */
const SECONDARY = "#3E432F";
/** Tan / cream accent */
const CREAM = "#FDEDCC";
const WHITE = "#ffffff";
const BORDER_SUBTLE = "#e5e0d8";
const INPUT_BORDER = "#c9c4b8";

export type ShippoElementsTheme = {
  elementId?: string;
  title?: string;
  style?: string;
  height?: string;
  width?: string;
  primaryColor?: string;
  container?: { backgroundColor?: string };
  header?: {
    backgroundColor?: string;
    borderColor?: string;
    color?: string;
    hasBoxShadow?: boolean;
    textAlign?: "left" | "right" | "center";
  };
  footer?: {
    backgroundColor?: string;
    borderColor?: string;
    hasBoxShadow?: boolean;
  };
  button?: {
    primary: {
      backgroundColor?: string;
      activeBackgroundColor?: string;
      hoverColor?: string;
      color?: string;
      borderRadius?: string;
      borderColor?: string;
      activeBorderColor?: string;
      textTransform?: "lowercase" | "uppercase" | "capitalize";
      disabledBackgroundColor?: string;
      disabledBorderColor?: string;
      disabledTextColor?: string;
    };
    secondary?: {
      backgroundColor?: string;
      activeBackgroundColor?: string;
      color?: string;
      borderRadius?: string;
      borderColor?: string;
      activeBorderColor?: string;
      textTransform?: "lowercase" | "uppercase" | "capitalize";
      disabledBackgroundColor?: string;
      disabledBorderColor?: string;
      disabledTextColor?: string;
    };
  };
  cards?: {
    subHeaderColor?: string;
    backgroundColor?: string;
    borderRadius?: string;
    borderColor?: string;
    borderStyle?: string;
    hoverBackgroundColor?: string;
    activeBackgroundColor?: string;
  };
  inputs?: {
    borderColor?: string;
    borderActive?: string;
    hoverColor?: string;
  };
  menu?: {
    titleBackgroundColor?: string;
    hoverColor?: string;
    hoverBackgroundColor?: string;
  };
};

export const NWC_SHIPPO_ELEMENTS_THEME: ShippoElementsTheme = {
  title: "Shipping Label",
  primaryColor: PRIMARY,
  /**
   * `style`/`height`/`width`/`title` are iframe HTML attributes (see embeddable-client
   * `buildIframe` defaults: height 600). Extra height is empty white under Next.
   */
  width: "100%",
  height: String(NWC_SHIPPO_IFRAME_HEIGHT_PX),
  style: "border:none;width:100%;max-width:100%;display:block;min-height:0",
  container: {
    backgroundColor: WHITE,
  },
  header: {
    backgroundColor: CREAM,
    borderColor: BORDER_SUBTLE,
    color: SECONDARY,
    hasBoxShadow: false,
    textAlign: "left",
  },
  footer: {
    backgroundColor: WHITE,
    borderColor: BORDER_SUBTLE,
    hasBoxShadow: false,
  },
  button: {
    primary: {
      backgroundColor: PRIMARY,
      activeBackgroundColor: SECONDARY,
      hoverColor: SECONDARY,
      color: WHITE,
      borderRadius: "4px",
      borderColor: PRIMARY,
      activeBorderColor: SECONDARY,
      textTransform: "capitalize",
      disabledBackgroundColor: "#a8ad9e",
      disabledBorderColor: "#a8ad9e",
      disabledTextColor: "#f0f0f0",
    },
    secondary: {
      backgroundColor: WHITE,
      activeBackgroundColor: CREAM,
      color: PRIMARY,
      borderRadius: "4px",
      borderColor: PRIMARY,
      activeBorderColor: PRIMARY,
      textTransform: "capitalize",
      disabledBackgroundColor: "#f5f5f5",
      disabledBorderColor: BORDER_SUBTLE,
      disabledTextColor: "#999",
    },
  },
  cards: {
    subHeaderColor: SECONDARY,
    backgroundColor: WHITE,
    borderRadius: "8px",
    borderColor: BORDER_SUBTLE,
    hoverBackgroundColor: "#faf9f7",
    activeBackgroundColor: CREAM,
  },
  inputs: {
    borderColor: INPUT_BORDER,
    borderActive: PRIMARY,
    hoverColor: PRIMARY,
  },
  menu: {
    titleBackgroundColor: CREAM,
    hoverColor: SECONDARY,
    hoverBackgroundColor: CREAM,
  },
};
