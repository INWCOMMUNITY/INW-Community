import type { Plan } from "database";

/** Higher = more privileged (Seller > Business > Resident). */
export function nwcPlanRank(p: Plan | string): number {
  if (p === "seller") return 3;
  if (p === "sponsor") return 2;
  if (p === "subscribe") return 1;
  return 0;
}
