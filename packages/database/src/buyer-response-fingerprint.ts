/**
 * Stable cart/checkout identity for custom answers.
 * No Node or Prisma imports: the storefront cart page bundles this file.
 */

type FingerprintResponse = {
  fieldId: string;
  kind: "TEXT" | "DROPDOWN" | "FILE";
  text: string | null;
  optionLabel: string | null;
  files: Array<{ url: string; label: string | null }>;
};

function parseForFingerprint(raw: unknown): FingerprintResponse[] {
  if (!Array.isArray(raw)) return [];
  const out: FingerprintResponse[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const rec = entry as FingerprintResponse;
    if (typeof rec.fieldId !== "string" || !rec.fieldId) continue;
    if (rec.kind !== "TEXT" && rec.kind !== "DROPDOWN" && rec.kind !== "FILE") continue;
    out.push({
      fieldId: rec.fieldId,
      kind: rec.kind,
      text: typeof rec.text === "string" ? rec.text : null,
      optionLabel: typeof rec.optionLabel === "string" ? rec.optionLabel : null,
      files: Array.isArray(rec.files)
        ? rec.files
            .filter((file) => file && typeof file.url === "string")
            .map((file) => ({ url: file.url, label: file.label ?? null }))
        : [],
    });
  }
  return out;
}

export function buyerResponsesFingerprint(raw: unknown): string {
  const stable = parseForFingerprint(raw)
    .map((row) => ({
      fieldId: row.fieldId,
      kind: row.kind,
      text: row.text ?? "",
      optionLabel: row.optionLabel ?? "",
      files: (row.files ?? []).map((file) => `${file.label ?? ""}:${file.url}`).sort(),
    }))
    .sort((a, b) => a.fieldId.localeCompare(b.fieldId));
  return JSON.stringify(stable);
}
