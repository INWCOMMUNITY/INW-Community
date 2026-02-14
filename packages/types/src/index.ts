export type Plan = "subscribe" | "sponsor" | "seller";

export type CalendarType =
  | "fun_events"
  | "local_art_music"
  | "non_profit"
  | "business_promotional"
  | "marketing"
  | "real_estate";

export type SavedItemType = "event" | "business" | "coupon" | "store_item";

// Editor / site content structure
export type BlockType =
  | "heading"
  | "paragraph"
  | "image"
  | "button"
  | "link"
  | "video"
  | "line"
  | "box"
  | "calendar";

export interface BlockPosition {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

/** Per-item styles for blocks (font, color, hover, border, etc.) */
export interface BlockStyles {
  fontSize?: string;
  fontFamily?: string;
  color?: string;
  backgroundColor?: string;
  hoverColor?: string;
  hoverTextColor?: string;
  borderWidth?: string;
  borderColor?: string;
  borderRadius?: string;
  textAlign?: "left" | "center" | "right" | "justify";
}

export interface ContentBlock {
  id: string;
  type: BlockType;
  content: Record<string, unknown>; // text, src, href, styles, etc.
  position?: BlockPosition;
  zIndex?: number;
}

export interface Column {
  id: string;
  blocks: ContentBlock[];
  width?: string; // e.g. "50%"
}

export interface Section {
  id: string;
  columns: Column[];
  layout?: "single" | "two-col" | "custom";
  height?: string;
  width?: string;
}

export interface PageStructure {
  sections: Section[];
}

export const CALENDAR_TYPES: { value: CalendarType; label: string }[] = [
  { value: "fun_events", label: "Fun Events Calendar" },
  { value: "local_art_music", label: "Local Art & Music Calendar" },
  { value: "non_profit", label: "Non-Profit Events Calendar" },
  { value: "business_promotional", label: "Business Promotional Events" },
  { value: "marketing", label: "Marketing Events" },
  { value: "real_estate", label: "Real Estate Events" },
];

export const PLAN_LABELS: Record<Plan, string> = {
  subscribe: "Subscribe",
  sponsor: "Sponsor",
  seller: "Seller",
};
