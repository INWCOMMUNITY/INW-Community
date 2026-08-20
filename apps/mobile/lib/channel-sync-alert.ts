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

/** Always show a result after List on {store} — success, failure, or empty. */
export function alertChannelPublishResult(channelSync: ChannelSyncRow[] | undefined): void {
  const rows = channelSync ?? [];
  const failed = rows.filter((r) => !r.ok);
  const succeeded = rows.filter((r) => r.ok);
  const successLines = succeeded.map((r) => PROVIDER_LABEL[r.provider] ?? r.provider);
  const failureLines = failed.map((r) => {
    const label = PROVIDER_LABEL[r.provider] ?? r.provider;
    const detail = r.error?.trim();
    return detail ? `${label}: ${detail.slice(0, 200)}` : `${label}: sync failed`;
  });

  if (rows.length === 0) {
    Alert.alert("Could not list", "Could not list on the selected store. Check Sync Stores and try again.");
    return;
  }
  if (failed.length === 0) {
    Alert.alert("Listed", `Listed on ${successLines.join(", ")}.`);
    return;
  }
  if (succeeded.length > 0) {
    Alert.alert(
      "Partially listed",
      `Listed on ${successLines.join(", ")}.\n\nCould not list on others:\n\n${failureLines.join("\n\n")}`
    );
    return;
  }
  Alert.alert("Could not list", failureLines.join("\n\n"));
}
