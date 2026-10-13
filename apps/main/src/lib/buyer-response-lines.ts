type BuyerFile = { url?: string; label?: string | null };
type BuyerRow = {
  title?: string;
  kind?: string;
  text?: string | null;
  optionLabel?: string | null;
  files?: BuyerFile[];
};

/** Client-safe display lines. Kept off the database package so the browser bundle does not load Prisma. */
export function formatBuyerResponseLines(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as BuyerRow;
    const title = typeof row.title === "string" && row.title.trim() ? row.title.trim() : "Custom option";
    if (row.kind === "TEXT") return [`${title}: ${row.text ?? ""}`];
    if (row.kind === "DROPDOWN") return [`${title}: ${row.optionLabel ?? ""}`];
    if (row.kind === "FILE") {
      const files = (row.files ?? [])
        .filter((file) => typeof file?.url === "string" && file.url)
        .map((file) => (file.label ? `${file.label}: ${file.url}` : file.url!));
      return [`${title}: ${files.join(", ")}`];
    }
    return [];
  });
}
