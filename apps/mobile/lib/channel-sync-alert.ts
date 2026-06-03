import { Alert } from "react-native";

export type ChannelSyncRow = {
  provider: string;
  ok: boolean;
  error?: string;
};

const PROVIDER_LABEL: Record<string, string> = {
  wix: "Wix",
  etsy: "Etsy",
  ebay: "eBay",
  shopify: "Shopify",
};

/** Alert when a marketplace push failed after save or delete (API still succeeded locally). */
export function alertChannelSyncFailures(
  channelSync: ChannelSyncRow[] | undefined,
  action: "saved" | "deleted" | "removed"
): void {
  const failed = (channelSync ?? []).filter((r) => !r.ok);
  if (failed.length === 0) return;

  const lines = failed.map((r) => {
    const label = PROVIDER_LABEL[r.provider] ?? r.provider;
    const detail = r.error?.trim();
    return detail ? `${label}: ${detail.slice(0, 200)}` : `${label}: sync failed`;
  });

  const title =
    action === "deleted"
      ? "Removed from INW"
      : action === "removed"
        ? "Removed from store"
        : "Saved on INW";
  const intro =
    action === "deleted"
      ? "removed from INW Community"
      : action === "removed"
        ? "removed from the selected marketplace"
        : "saved";

  Alert.alert(
    title,
    `Your listing was ${intro}, but could not update ${failed.length === 1 ? "a connected store" : "some connected stores"}:\n\n${lines.join("\n\n")}`,
    [{ text: "OK" }]
  );
}
