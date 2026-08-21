/** Display group categories in title case (e.g. FISHING → Fishing). */
export function titleCaseCategory(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .map((word) =>
      word
        .split(/([-&])/)
        .map((part) => {
          if (part === "-" || part === "&") return part;
          if (!part) return part;
          return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
        })
        .join("")
    )
    .join(" ");
}
