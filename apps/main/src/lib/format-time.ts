/**
 * Parses a military/24-hour time string (e.g. "22:00", "09:30") and returns 12-hour format (e.g. "10:00 PM", "9:30 AM").
 * Handles ranges like "9:00 - 17:00" by formatting each part.
 */
export function formatTime12h(time: string): string {
  if (!time || typeof time !== "string") return "";
  const trimmed = time.trim();
  if (!trimmed) return "";

  // Check for range (e.g. "9:00 - 17:00" or "9:00 AM - 5:00 PM")
  const rangeMatch = trimmed.match(/^(.+?)\s*[-–—]\s*(.+)$/);
  if (rangeMatch) {
    const start = formatSingleTime(rangeMatch[1].trim());
    const end = formatSingleTime(rangeMatch[2].trim());
    if (start && end) return `${start} – ${end}`;
    return trimmed; // fallback if parsing fails
  }

  return formatSingleTime(trimmed) || trimmed;
}

function formatSingleTime(s: string): string {
  // Already has AM/PM
  if (/\d{1,2}:\d{2}\s*(AM|PM)/i.test(s)) return s;

  // Match HH:mm or H:mm (24-hour)
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return s;

  let hours = parseInt(m[1], 10);
  const minutes = parseInt(m[2], 10);
  if (isNaN(hours) || isNaN(minutes) || minutes > 59) return s;

  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12;
  if (hours === 0) hours = 12;

  const minStr = String(minutes).padStart(2, "0");
  return `${hours}:${minStr} ${ampm}`;
}
