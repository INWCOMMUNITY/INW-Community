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
  const failed = rows.filter((r) => !r.ok);
  const succeeded = rows.filter((r) => r.ok);
  const successLines = succeeded.map((r) => providerLabel(r.provider));
  const failureLines = failed.map((r) => {
    const label = providerLabel(r.provider);
    const detail = r.error?.trim();
    return detail ? `${label}: ${detail.slice(0, 200)}` : `${label}: sync failed`;
  });

  const title =
    action === "deleted"
      ? "Removed from INW"
      : action === "removed"
        ? "Removed from store"
        : failed.length === 0
          ? "Saved successfully"
          : "Saved on INW";

  const intro =
    action === "deleted"
      ? "removed from INW Community"
      : action === "removed"
        ? "removed from the selected marketplace"
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
  failureLines: string[]
): string {
  if (failureLines.length === 0) return "";
  return `Your listing was ${intro}, but could not update ${
    failureLines.length === 1 ? "a connected store" : "some connected stores"
  }:\n\n${failureLines.join("\n\n")}`;
}

export function alertChannelSyncFailures(
  channelSync: ChannelSyncRow[] | undefined,
  action: "saved" | "deleted" | "removed" = "saved"
) {
  const result = formatChannelSyncResults(channelSync, action);
  if (!channelSync?.length || result.allOk) return;
  if (typeof window === "undefined") return;
  window.alert(buildSyncFailureMessage(result.intro, result.failureLines));
}
