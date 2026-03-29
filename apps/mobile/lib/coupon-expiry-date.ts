/** Local calendar date from an API ISO string (for date inputs). */
export function isoToYmdLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** End of that calendar day in local time as ISO, or null if invalid. */
export function ymdToEndOfDayIso(ymd: string): string | null {
  const t = ymd.trim();
  if (!t) return null;
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const d = parseInt(m[3], 10);
  const end = new Date(y, mo - 1, d, 23, 59, 59, 999);
  if (Number.isNaN(end.getTime())) return null;
  if (end.getFullYear() !== y || end.getMonth() !== mo - 1 || end.getDate() !== d) return null;
  return end.toISOString();
}
