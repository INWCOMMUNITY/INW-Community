export type ImportBatchProgress = {
  state: string;
  processed: number;
  total: number;
  scanning: boolean;
  cancelRequested: boolean;
};

export function importProgressLabel(batch: ImportBatchProgress): string | null {
  if (batch.state !== "PENDING" && batch.state !== "RUNNING") return null;
  if (batch.cancelRequested) return "Cancelling import…";
  if (batch.scanning || batch.total <= 0) return "Finding listings…";
  const done = Math.min(batch.processed, batch.total);
  return `${done}/${batch.total} listings imported`;
}

export function importProgressPercent(batch: ImportBatchProgress): number {
  if (batch.state !== "PENDING" && batch.state !== "RUNNING") return 0;
  if (batch.scanning || batch.total <= 0) return 12;
  return Math.min(100, Math.round((Math.min(batch.processed, batch.total) / batch.total) * 100));
}
