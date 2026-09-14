import type { ChannelProvider } from "./types";

export type SuggestedRepairKind =
  | "adopt_pin"
  | "clear_leftover_parent"
  | "assign_canonical"
  | "rewrite_remote";

export type SuggestedRepair = {
  kind: SuggestedRepairKind;
  provider?: ChannelProvider;
  label: string;
};

function isJoinKeySku(sku: string | null | undefined): boolean {
  const trimmed = sku?.trim() ?? "";
  return /^[a-zA-Z0-9]{1,50}$/.test(trimmed);
}

/** Observation-first: these are the Method-2 buttons a seller can choose. */
export function suggestedSkuRepairs(unit: {
  kind: "parent" | "combo";
  catalogFindings: string[];
  inwSku: string | null;
  channels: { provider: string; remoteSku: string | null; class: string }[];
}): SuggestedRepair[] {
  const out: SuggestedRepair[] = [];
  if (unit.kind === "parent" && unit.catalogFindings.includes("parent_is_variant_leftover")) {
    out.push({ kind: "clear_leftover_parent", label: "Clear leftover parent SKU" });
  }
  const ebay = unit.channels.find((c) => c.provider === "ebay");
  const missing = !unit.inwSku || unit.catalogFindings.includes("missing");
  if (missing && ebay?.remoteSku && isJoinKeySku(ebay.remoteSku)) {
    out.push({ kind: "adopt_pin", label: "Adopt eBay SKU" });
  } else if (missing) {
    out.push({ kind: "assign_canonical", label: "Assign SKU" });
  }
  if (unit.inwSku && isJoinKeySku(unit.inwSku)) {
    for (const c of unit.channels) {
      if ((c.provider === "etsy" || c.provider === "wix") && c.class !== "exact") {
        out.push({
          kind: "rewrite_remote",
          provider: c.provider as ChannelProvider,
          label: `Copy SKU to ${c.provider === "etsy" ? "Etsy" : "Wix"}`,
        });
      }
    }
  }
  return out;
}
