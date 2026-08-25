export type ImportJobProgressInput = {
  status: "pending" | "processing" | "completed" | "failed" | string;
  total: number;
  completed: number;
  failed: number;
};

/**
 * Percent for the import bar. 100 only when the job is completed.
 * While processing, cap at 99 even if every listing has a result.
 */
export function importJobDisplayPercent(job: ImportJobProgressInput): number {
  if (job.status === "completed") return 100;
  if (job.total <= 0) return 0;
  const raw = Math.round((100 * (job.completed + job.failed)) / job.total);
  return Math.min(99, Math.max(0, raw));
}

/** Keep the bar off 0% while the first listing is in flight. */
export function easedImportPercent(percent: number, inFlight: boolean, processed: number): number {
  if (percent >= 100) return 100;
  if (inFlight && processed <= 0 && percent <= 0) return 4;
  return percent;
}
