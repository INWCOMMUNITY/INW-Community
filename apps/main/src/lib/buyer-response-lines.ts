type BuyerFile = { url?: string; label?: string | null };
type BuyerRow = {
  title?: string;
  kind?: string;
  text?: string | null;
  optionLabel?: string | null;
  files?: BuyerFile[];
};

export type BuyerResponseView = {
  title: string;
  kind: "TEXT" | "DROPDOWN" | "FILE";
  text: string | null;
  optionLabel: string | null;
  files: Array<{ url: string; label: string | null }>;
};

export function parseBuyerResponseViews(raw: unknown): BuyerResponseView[] {
  if (!Array.isArray(raw)) return [];
  const views: BuyerResponseView[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as BuyerRow;
    const kind = row.kind === "TEXT" || row.kind === "DROPDOWN" || row.kind === "FILE" ? row.kind : null;
    if (!kind) continue;
    const title = typeof row.title === "string" && row.title.trim() ? row.title.trim() : "Custom option";
    const files = (row.files ?? [])
      .filter((file) => typeof file?.url === "string" && file.url.trim())
      .map((file) => ({
        url: file.url!.trim(),
        label: typeof file.label === "string" && file.label.trim() ? file.label.trim() : null,
      }));
    views.push({
      title,
      kind,
      text: typeof row.text === "string" ? row.text : null,
      optionLabel: typeof row.optionLabel === "string" ? row.optionLabel : null,
      files,
    });
  }
  return views;
}

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
