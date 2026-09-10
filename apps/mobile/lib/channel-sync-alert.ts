import { Alert } from "react-native";

export type ChannelSyncRow = {
  provider: string;
  ok: boolean;
  error?: string;
  /** Intentionally not pushed (paused/pull-only, sync disabled, or LWW kept the shop's copy). */
  skipped?: string;
};

function isListingVisibleSyncFailure(row: ChannelSyncRow): boolean {
  return !row.ok;
}

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
  const failed = (channelSync ?? []).filter(isListingVisibleSyncFailure);
  if (failed.length === 0) return;

  const lines = failed.map((r) => {
    const label = PROVIDER_LABEL[r.provider] ?? r.provider;
    const detail = r.error?.trim();
    return detail ? `${label}: ${detail.slice(0, 200)}` : `${label}: sync failed`;
  });

  const title =
    action === "deleted"
      ? "Removed From INW"
      : action === "removed"
        ? "Could Not Remove From Stores"
        : "Saved On INW";
  const message =
    action === "removed"
      ? `Could not remove this listing from ${failed.length === 1 ? "the connected store" : "some connected stores"}. It is still linked in INW so you will not create a duplicate:\n\n${lines.join("\n\n")}`
      : `Your listing was ${
          action === "deleted" ? "removed from INW Community" : "saved"
        }, but could not update ${failed.length === 1 ? "a connected store" : "some connected stores"}:\n\n${lines.join("\n\n")}`;

  Alert.alert(title, message, [{ text: "OK" }]);
}

/** Always show a result after List on {store} — success, failure, or empty. */
export function alertChannelPublishResult(channelSync: ChannelSyncRow[] | undefined): void {
  const rows = channelSync ?? [];
  const failed = rows.filter(isListingVisibleSyncFailure);
  // Skipped rows (paused/pull-only, sync disabled, LWW kept the shop's copy) were not pushed, so
  // they must not be reported as "Listed on X".
  const succeeded = rows.filter((r) => !isListingVisibleSyncFailure(r) && !r.skipped);
  const successLines = succeeded.map((r) => PROVIDER_LABEL[r.provider] ?? r.provider);
  const failureLines = failed.map((r) => {
    const label = PROVIDER_LABEL[r.provider] ?? r.provider;
    const detail = r.error?.trim();
    return detail ? `${label}: ${detail.slice(0, 200)}` : `${label}: sync failed`;
  });

  if (rows.length === 0 || (succeeded.length === 0 && failed.length === 0)) {
    Alert.alert("That Store Didn't Take It", "Could not list on the selected store. Check Sync Stores and try again.");
    return;
  }
  if (failed.length === 0) {
    Alert.alert("You're Live", `Listed on ${successLines.join(", ")}. Shoppers can find it there now.`);
    return;
  }
  if (succeeded.length > 0) {
    Alert.alert(
      failed.length === 1 ? "Almost — One Store Said No" : "Almost — Some Stores Said No",
      `Listed on ${successLines.join(", ")}.\n\nCould not list on others:\n\n${failureLines.join("\n\n")}`
    );
    return;
  }
  Alert.alert("That Store Said No", failureLines.join("\n\n"));
}
