/** Shippo label PDF / widget re-access window after purchase (24 hours). */
export const LABEL_REPRINT_WINDOW_MS = 24 * 60 * 60 * 1000;

export function isWithinLabelReprintWindow(createdAt: string | Date | null | undefined): boolean {
  if (createdAt == null) return false;
  const t = new Date(createdAt).getTime();
  if (Number.isNaN(t)) return false;
  return Date.now() - t < LABEL_REPRINT_WINDOW_MS;
}
