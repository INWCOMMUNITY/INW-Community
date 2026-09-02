import { isEbayPhotoHostFamilySyncError } from "./channels/ebay/errors";

export type ChannelSyncRow = {
  provider: string;
  ok: boolean;
  error?: string;
};

function isListingVisibleSyncFailure(row: ChannelSyncRow): boolean {
  if (row.ok) return false;
  if (row.provider === "ebay" && isEbayPhotoHostFamilySyncError(row.error)) return false;
  return true;
}

const PROVIDER_LABEL: Record<string, string> = {
  wix: "Wix",
  etsy: "Etsy",
  ebay: "eBay",
  shopify: "Shopify",
};

export function providerLabel(provider: string): string {
  return PROVIDER_LABEL[provider] ?? provider;
}

export function formatChannelSyncResults(
  channelSync: ChannelSyncRow[] | undefined,
  action: "saved" | "deleted" | "removed" = "saved"
): {
  allOk: boolean;
  failed: ChannelSyncRow[];
  succeeded: ChannelSyncRow[];
  successLines: string[];
  failureLines: string[];
  title: string;
  intro: string;
} {
  const rows = channelSync ?? [];
  const failed = rows.filter(isListingVisibleSyncFailure);
  const succeeded = rows.filter((r) => !isListingVisibleSyncFailure(r));
  const successLines = succeeded.map((r) => providerLabel(r.provider));
  const failureLines = failed.map((r) => {
    const label = providerLabel(r.provider);
    const detail = r.error?.trim();
    return detail ? `${label}: ${detail.slice(0, 800)}` : `${label}: sync failed`;
  });

  const title =
    action === "deleted"
      ? failed.length > 0 && succeeded.length === 0
        ? "Could Not Delete From Connected Stores"
        : "Removed From INW"
      : action === "removed"
        ? failed.length > 0 && succeeded.length === 0
          ? "Could Not Remove From Stores"
          : "Removed From Stores"
        : failed.length === 0
          ? "Saved Successfully"
          : succeeded.length > 0
            ? "Partially Listed"
            : "Saved On INW";

  const intro =
    action === "deleted"
      ? "removed from INW Community"
      : action === "removed"
        ? "not removed from the selected marketplace"
        : "saved";

  return {
    allOk: failed.length === 0,
    failed,
    succeeded,
    successLines,
    failureLines,
    title,
    intro,
  };
}

export function buildSyncSuccessMessage(successLines: string[]): string {
  if (successLines.length === 0) return "Your listing is saved on INW.";
  if (successLines.length === 1) {
    return `Saved and synced to ${successLines[0]}.`;
  }
  return `Saved and synced to ${successLines.join(", ")}.`;
}

export function buildSyncFailureMessage(
  intro: string,
  failureLines: string[],
  action: "saved" | "deleted" | "removed" = "saved"
): string {
  if (failureLines.length === 0) return "";
  if (action === "removed") {
    return `Could not remove this listing from ${
      failureLines.length === 1 ? "the connected store" : "some connected stores"
    }. It is still linked in INW so you will not create a duplicate:\n\n${failureLines.join("\n\n")}`;
  }
  return `Your listing was ${intro}, but could not update ${
    failureLines.length === 1 ? "a connected store" : "some connected stores"
  }:\n\n${failureLines.join("\n\n")}`;
}

export function buildPublishResultAlert(
  channelSync: ChannelSyncRow[] | undefined
): { title: string; message: string } {
  const rows = channelSync ?? [];
  const result = formatChannelSyncResults(rows, "saved");
  if (rows.length === 0) {
    return {
      title: "That Store Didn't Take It",
      message: "Could not list on the selected store. Check Sync Stores and try again.",
    };
  }
  if (result.allOk) {
    const listed =
      result.successLines.length === 1
        ? result.successLines[0]
        : result.successLines.join(", ");
    return {
      title: "You're Live",
      message: `Listed on ${listed}. Shoppers can find it there now.`,
    };
  }
  if (result.succeeded.length > 0) {
    return {
      title:
        result.failureLines.length === 1 ? "Almost — One Store Said No" : "Almost — Some Stores Said No",
      message: `Listed on ${result.successLines.join(", ")}.\n\nCould not list on others:\n\n${result.failureLines.join("\n\n")}`,
    };
  }
  return {
    title: "That Store Said No",
    message: result.failureLines.join("\n\n"),
  };
}

export function isChannelPublishOk(channelSync: ChannelSyncRow[] | undefined): boolean {
  const rows = channelSync ?? [];
  return rows.length > 0 && rows.every((r) => r.ok);
}

export function alertChannelSyncFailures(
  channelSync: ChannelSyncRow[] | undefined,
  action: "saved" | "deleted" | "removed" = "saved"
) {
  const result = formatChannelSyncResults(channelSync, action);
  if (!channelSync?.length || result.allOk) return;
  if (typeof window === "undefined") return;
  window.alert(buildSyncFailureMessage(result.intro, result.failureLines, action));
}

/** Always show a result after List on {store} — success, failure, or empty. */
export function alertChannelPublishResult(channelSync: ChannelSyncRow[] | undefined) {
  if (typeof window === "undefined") return;
  const alert = buildPublishResultAlert(channelSync);
  window.alert(`${alert.title}\n\n${alert.message}`);
}
