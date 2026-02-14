/** Format 24h time (e.g. "22:00") to 12h (e.g. "10:00 PM"). */
export function formatTime12h(time: string | null): string {
  if (!time || typeof time !== "string") return "";
  const m = time.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return time;
  let hours = parseInt(m[1], 10);
  const minutes = parseInt(m[2], 10);
  if (isNaN(hours) || isNaN(minutes)) return time;
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12;
  if (hours === 0) hours = 12;
  return `${hours}:${String(minutes).padStart(2, "0")} ${ampm}`;
}
