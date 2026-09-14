"use client";

import { useCallback, useEffect, useState } from "react";
import { suggestedSkuRepairs, type SuggestedRepair } from "@/lib/channels/sku-repair-suggest";

type ChannelHit = {
  provider: string;
  remoteSku: string | null;
  class: string;
  matchQuality: string;
};

type AuditUnit = {
  storeItemId: string;
  title: string;
  kind: "parent" | "combo";
  comboKey: string | null;
  comboLabel: string | null;
  inwSku: string | null;
  catalogFindings: string[];
  channels: ChannelHit[];
};

type ExtraRemote = {
  storeItemId: string;
  title: string;
  provider: string;
  remoteSku: string | null;
  class: string;
};

type RewriteVerdict = {
  recommendation: string;
  hyphenOnlyShopifyMismatches: number;
  ebayNormalizedEqualPin: number;
  itemIdFallbacks: number;
  leftoverParents: number;
  etsyClampHashes: number;
  ebayLiveUnusable: number;
  inwCanonicalCount: number;
  inwMissingCount: number;
  hyphenPunctCount: number;
};

type LiveStatus = {
  attempted: boolean;
  providersChecked: string[];
  providersSkipped: { provider: string; reason: string; linkCount: number }[];
  listingsHydrated: number;
};

type AuditReport = {
  ok?: boolean;
  live: boolean;
  liveStatus?: LiveStatus;
  units: AuditUnit[];
  extras: ExtraRemote[];
  rewriteVerdict: RewriteVerdict;
  compact: {
    issueCount: number;
    topClasses: { class: string; count: number }[];
    rewriteVerdict: string;
  };
  hydrateErrors: { storeItemId: string; provider: string; error: string }[];
};

const VERDICT_COPY: Record<string, string> = {
  keep_adapters_replace_generators:
    "Keep the channel adapters. Replace the per-channel SKU generators so every sellable unit uses the same alphanumeric SKU.",
  pin_ebay_rewrite_shopify_fields:
    "Pin live eBay Custom Labels. Strip hyphens on Shopify (and INW leftovers) so the string matches everywhere. Do not rename live eBay Inventory SKUs.",
  full_identity_reset:
    "Live eBay SKUs are unusable and INW has no canonical codes. Rebuild identity on INW first, then push to Shopify/Etsy/Wix. Still do not delete Inventory API SKU usage.",
};

function issueClass(unit: AuditUnit): string {
  const channelIssue = unit.channels.find((c) => c.class !== "exact");
  if (unit.catalogFindings[0]) return unit.catalogFindings.join(", ");
  if (channelIssue) return `${channelIssue.provider}: ${channelIssue.class}`;
  return "ok";
}

function channelSku(unit: AuditUnit, provider: string): string {
  return unit.channels.find((c) => c.provider === provider)?.remoteSku ?? "—";
}

function titleCaseProvider(provider: string): string {
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

function issueHeadline(report: AuditReport): string {
  const n = report.compact.issueCount;
  const issues = `${n} issue${n === 1 ? "" : "s"}`;
  if (!report.live) return `${issues} (INW catalog)`;
  const hydrated = report.liveStatus?.listingsHydrated ?? 0;
  if (hydrated > 0) return `${issues} (includes live channels)`;
  return `${issues} (INW catalog — live channels were not read)`;
}

function uniqueHydrateErrors(
  errors: AuditReport["hydrateErrors"]
): AuditReport["hydrateErrors"] {
  const seen = new Set<string>();
  const out: AuditReport["hydrateErrors"] = [];
  for (const e of errors) {
    const key = `${e.provider}:${e.error}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

function unitKey(unit: AuditUnit): string {
  return `${unit.storeItemId}:${unit.kind}:${unit.comboKey ?? unit.comboLabel ?? ""}`;
}

export function SkuAuditPanel() {
  const [report, setReport] = useState<AuditReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [liveBusy, setLiveBusy] = useState(false);
  const [repairing, setRepairing] = useState<string | null>(null);
  const [assignDraft, setAssignDraft] = useState<Record<string, string>>({});
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const load = useCallback(async (live: boolean) => {
    if (live) setLiveBusy(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/channels/sku-audit${live ? "?live=1" : ""}`, {
        credentials: "include",
      });
      const data = (await res.json()) as AuditReport & { error?: string };
      if (!res.ok) {
        setError(data.error || "SKU audit failed.");
        setReport(null);
        return;
      }
      setReport(data);
    } catch {
      setError("SKU audit failed.");
      setReport(null);
    } finally {
      setLoading(false);
      setLiveBusy(false);
    }
  }, []);

  const runRepair = useCallback(
    async (unit: AuditUnit, action: SuggestedRepair) => {
      const key = `${unitKey(unit)}:${action.kind}:${action.provider ?? ""}`;
      if (action.kind === "rewrite_remote" || action.kind === "adopt_pin") {
        const ok = window.confirm(
          `${action.label} for “${unit.title}”? This copies the SKU string and does not delete the listing.`
        );
        if (!ok) return;
      }
      setRepairing(key);
      setActionMessage(null);
      setError(null);
      try {
        const res = await fetch("/api/channels/sku-repair", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            storeItemId: unit.storeItemId,
            kind: action.kind,
            provider: action.provider,
            comboKey: unit.comboKey,
            sku: action.kind === "assign_canonical" ? assignDraft[unitKey(unit)] : undefined,
          }),
        });
        const data = (await res.json()) as { ok?: boolean; message?: string; error?: string };
        if (!res.ok) {
          setError(data.error || "SKU repair failed.");
          return;
        }
        setActionMessage(data.message || "Updated.");
        await load(Boolean(report?.live));
      } catch {
        setError("SKU repair failed.");
      } finally {
        setRepairing(null);
      }
    },
    [assignDraft, load, report?.live]
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  if (loading && !report) {
    return <p className="text-gray-500 py-8 text-center">Scanning INW SKUs…</p>;
  }

  if (error && !report) {
    return <p className="text-red-700 text-sm">{error}</p>;
  }

  if (!report) return null;

  const rows = report.units.filter((u) => {
    if (u.catalogFindings.length > 0) return true;
    if (u.channels.some((c) => c.class !== "exact")) return true;
    if (report.live && u.channels.length > 0) return true;
    return false;
  });
  const showRows = rows.length > 0 ? rows : report.units.slice(0, 25);
  const liveStatus = report.liveStatus;
  const hydrateErrors = uniqueHydrateErrors(report.hydrateErrors);
  const rewriteShown = new Set<string>();

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">
        Every sellable unit should use the same alphanumeric SKU on INW, eBay, Etsy, Shopify, and
        Wix. Observation is the default. Repair buttons copy that string (Method 2) — they do not
        unsync or delete listings.
      </p>

      <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm space-y-2">
        <p className="font-semibold text-gray-900">{issueHeadline(report)}</p>
        <p className="text-gray-700">
          {VERDICT_COPY[report.rewriteVerdict.recommendation] ?? report.rewriteVerdict.recommendation}
        </p>
        <ul className="text-gray-600 list-disc pl-5 space-y-0.5">
          {report.compact.topClasses.map((c) => (
            <li key={c.class}>
              {c.class}: {c.count}
            </li>
          ))}
        </ul>
        <p className="text-gray-500 text-xs">
          Leftover parents {report.rewriteVerdict.leftoverParents} · item.id fallbacks{" "}
          {report.rewriteVerdict.itemIdFallbacks} · hyphen/punct {report.rewriteVerdict.hyphenPunctCount}{" "}
          · canonical {report.rewriteVerdict.inwCanonicalCount} · missing{" "}
          {report.rewriteVerdict.inwMissingCount}
        </p>
        {report.live && liveStatus ? (
          <div className="text-xs text-gray-600 space-y-0.5 pt-1">
            {liveStatus.providersChecked.length > 0 ? (
              <p>
                Live GET:{" "}
                {liveStatus.providersChecked.map(titleCaseProvider).join(", ")} (
                {liveStatus.listingsHydrated} listing
                {liveStatus.listingsHydrated === 1 ? "" : "s"})
              </p>
            ) : (
              <p>No connected channel could be read.</p>
            )}
            {liveStatus.providersSkipped.map((s) => (
              <p key={s.provider}>
                Skipped {titleCaseProvider(s.provider)}: {s.reason} ({s.linkCount} leftover
                listing {s.linkCount === 1 ? "link" : "links"})
              </p>
            ))}
          </div>
        ) : null}
      </div>

      <button
        type="button"
        disabled={liveBusy}
        onClick={() => void load(true)}
        className="inline-flex items-center justify-center rounded-lg border-2 border-[var(--color-primary)] bg-white px-4 py-2 text-sm font-semibold text-[var(--color-primary)] disabled:opacity-50"
      >
        {liveBusy ? "Checking live channels…" : "Check live channels"}
      </button>
      {error ? <p className="text-red-700 text-sm">{error}</p> : null}
      {actionMessage ? <p className="text-green-800 text-sm">{actionMessage}</p> : null}

      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="min-w-full text-xs text-left">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="px-2 py-2 font-medium">Item</th>
              <th className="px-2 py-2 font-medium">Combo</th>
              <th className="px-2 py-2 font-medium">INW</th>
              <th className="px-2 py-2 font-medium">eBay</th>
              <th className="px-2 py-2 font-medium">Etsy</th>
              <th className="px-2 py-2 font-medium">Shopify</th>
              <th className="px-2 py-2 font-medium">Wix</th>
              <th className="px-2 py-2 font-medium">Class</th>
              <th className="px-2 py-2 font-medium">Repair</th>
            </tr>
          </thead>
          <tbody>
            {showRows.map((u) => {
              const actions = suggestedSkuRepairs(u).filter((a) => {
                if (a.kind !== "rewrite_remote") return true;
                const key = `${u.storeItemId}:${a.provider}`;
                if (rewriteShown.has(key)) return false;
                rewriteShown.add(key);
                return true;
              });
              const draftKey = unitKey(u);
              return (
              <tr key={draftKey} className="border-t border-gray-100">
                <td className="px-2 py-2 max-w-[140px] truncate" title={u.title}>
                  {u.title}
                </td>
                <td className="px-2 py-2 whitespace-nowrap">{u.comboLabel ?? "parent"}</td>
                <td className="px-2 py-2 font-mono">{u.inwSku ?? "—"}</td>
                <td className="px-2 py-2 font-mono">{channelSku(u, "ebay")}</td>
                <td className="px-2 py-2 font-mono">{channelSku(u, "etsy")}</td>
                <td className="px-2 py-2 font-mono">{channelSku(u, "shopify")}</td>
                <td className="px-2 py-2 font-mono">{channelSku(u, "wix")}</td>
                <td className="px-2 py-2">{issueClass(u)}</td>
                <td className="px-2 py-2">
                  <div className="flex flex-col gap-1 min-w-[140px]">
                    {actions.map((action) => {
                      const busyKey = `${draftKey}:${action.kind}:${action.provider ?? ""}`;
                      if (action.kind === "assign_canonical") {
                        return (
                          <div key={busyKey} className="flex gap-1">
                            <input
                              value={assignDraft[draftKey] ?? ""}
                              onChange={(e) =>
                                setAssignDraft((prev) => ({ ...prev, [draftKey]: e.target.value }))
                              }
                              placeholder="SKU"
                              className="w-24 rounded border border-gray-300 px-1 py-0.5 font-mono"
                            />
                            <button
                              type="button"
                              disabled={repairing != null}
                              onClick={() => void runRepair(u, action)}
                              className="rounded border border-gray-300 px-1.5 py-0.5 font-semibold disabled:opacity-50"
                            >
                              {repairing === busyKey ? "…" : "Assign"}
                            </button>
                          </div>
                        );
                      }
                      return (
                        <button
                          key={busyKey}
                          type="button"
                          disabled={repairing != null}
                          onClick={() => void runRepair(u, action)}
                          className="rounded border border-gray-300 px-1.5 py-0.5 text-left font-semibold disabled:opacity-50"
                        >
                          {repairing === busyKey ? "…" : action.label}
                        </button>
                      );
                    })}
                  </div>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-gray-500">No catalog issues. Showing a sample of units.</p>
      ) : null}

      {hydrateErrors.length > 0 ? (
        <div className="text-xs text-amber-800">
          <p className="font-semibold mb-1">Live read errors</p>
          <ul className="list-disc pl-5">
            {hydrateErrors.slice(0, 10).map((e) => (
              <li key={`${e.storeItemId}:${e.provider}:${e.error}`}>
                {e.provider}
                {e.storeItemId ? ` (${e.storeItemId.slice(0, 8)}…)` : ""}: {e.error}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {report.extras.length > 0 ? (
        <div className="text-xs text-gray-600">
          <p className="font-semibold mb-1">Extra remote SKUs (not on INW)</p>
          <ul className="list-disc pl-5">
            {report.extras.slice(0, 15).map((e, i) => (
              <li key={`${e.storeItemId}:${e.provider}:${e.remoteSku}:${i}`}>
                {e.provider} {e.class} {e.remoteSku ?? "(empty)"} — {e.title}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
