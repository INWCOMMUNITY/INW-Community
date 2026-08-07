/**
 * Shared card styling constants matching the app's design system.
 */

export const CARD_SHADOW = "shadow-sm";
export const CARD_RADIUS = "rounded-xl"; // 12px
export const CARD_BORDER = "border border-[#e0e0e0]";

/** Standard card container classes */
export const CARD_CLASSES = `${CARD_RADIUS} ${CARD_SHADOW} bg-white overflow-hidden`;

/** Card with border */
export const CARD_BORDERED_CLASSES = `${CARD_CLASSES} ${CARD_BORDER}`;

/** Product/item card aspect ratio */
export const CARD_PRODUCT_ASPECT = "aspect-[4/5]";

/** Post/feed card padding */
export const CARD_PADDING = "p-3 md:p-4";
