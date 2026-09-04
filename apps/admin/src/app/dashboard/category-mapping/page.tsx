"use client";

import { adminFetch } from "@/lib/admin-fetch";

import { useState, useEffect } from "react";

const MAIN_URL = process.env.NEXT_PUBLIC_MAIN_SITE_URL || "http://localhost:3000";

interface MappingStat {
  provider: string;
  remoteCategory: string;
  mappedCategory: string;
  mappedSubcat: string | null;
  confidence: number;
  overrideCount: number;
  keepCount: number;
  overrideRate: number;
}

interface Feedback {
  id: string;
  provider: string;
  remoteCategory: string;
  remoteSubcat: string | null;
  autoMapped: string;
  autoMappedSub: string | null;
  sellerChosen: string;
  sellerChosenSub: string | null;
  confidence: number | null;
  memberName: string;
  createdAt: string;
}

interface Summary {
  totalMappings: number;
  highOverrideRate: number;
  lowConfidence: number;
  needsAttention: number;
}

const PROVIDER_NAMES: Record<string, string> = {
  etsy: "Etsy",
  ebay: "eBay",
  shopify: "Shopify",
  wix: "Wix",
};

function ConfidenceBadge({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100);
  const color = pct >= 70 ? "bg-green-100 text-green-800" :
                pct >= 40 ? "bg-yellow-100 text-yellow-800" :
                "bg-red-100 text-red-800";
  return (
    <span className={`px-2 py-1 rounded text-xs font-medium ${color}`}>
      {pct}%
    </span>
  );
}

export default function CategoryMappingPage() {
  const [stats, setStats] = useState<MappingStat[]>([]);
  const [feedback, setFeedback] = useState<Feedback[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [filterProvider, setFilterProvider] = useState("");
  const [viewMode, setViewMode] = useState<"stats" | "feedback">("stats");

  async function fetchData() {
    setLoading(true);
    try {
      const params = filterProvider ? `?provider=${filterProvider}` : "";
      const res = await adminFetch(`${MAIN_URL}/api/admin/category-mapping${params}`, {
        });
      const json = await res.json();
      setStats(json.stats ?? []);
      setFeedback(json.recentFeedback ?? []);
      setSummary(json.summary ?? null);
    } catch (e) {
      console.error("Failed to fetch category mapping data:", e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchData();
  }, [filterProvider]);

  // Sort stats - high override rate first (needs attention)
  const sortedStats = [...stats].sort((a, b) => b.overrideRate - a.overrideRate);

  // Stats needing attention (high override or low confidence)
  const needsAttention = sortedStats.filter(
    (s) => s.overrideRate > 0.3 || s.confidence < 0.5
  );

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Category Mapping Analytics</h1>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-sm text-gray-500">Total Mappings</p>
            <p className="text-2xl font-bold">{summary.totalMappings}</p>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-sm text-gray-500">High Override Rate</p>
            <p className="text-2xl font-bold text-yellow-600">{summary.highOverrideRate}</p>
            <p className="text-xs text-gray-400">&gt;30% overridden</p>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-sm text-gray-500">Low Confidence</p>
            <p className="text-2xl font-bold text-red-600">{summary.lowConfidence}</p>
            <p className="text-xs text-gray-400">&lt;50% confidence</p>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-sm text-gray-500">Needs Attention</p>
            <p className="text-2xl font-bold text-orange-600">{summary.needsAttention}</p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-4 mb-6">
        <select
          value={filterProvider}
          onChange={(e) => setFilterProvider(e.target.value)}
          className="border rounded px-3 py-2 text-sm"
        >
          <option value="">All Providers</option>
          <option value="etsy">Etsy</option>
          <option value="ebay">eBay</option>
          <option value="shopify">Shopify</option>
          <option value="wix">Wix</option>
        </select>

        <div className="flex border rounded overflow-hidden">
          <button
            onClick={() => setViewMode("stats")}
            className={`px-4 py-2 text-sm ${viewMode === "stats" ? "bg-blue-500 text-white" : "bg-white"}`}
          >
            Mapping Stats
          </button>
          <button
            onClick={() => setViewMode("feedback")}
            className={`px-4 py-2 text-sm ${viewMode === "feedback" ? "bg-blue-500 text-white" : "bg-white"}`}
          >
            Recent Feedback
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-gray-500">Loading…</p>
      ) : viewMode === "stats" ? (
        <>
          {/* Needs Attention Section */}
          {needsAttention.length > 0 && (
            <div className="mb-8">
              <h2 className="font-semibold text-orange-600 mb-2">
                ⚠️ Mappings Needing Attention ({needsAttention.length})
              </h2>
              <p className="text-sm text-gray-500 mb-4">
                These mappings have high override rates or low confidence. Consider adding aliases
                to category-resolver.ts.
              </p>
              <div className="overflow-x-auto">
                <table className="min-w-full bg-white shadow rounded">
                  <thead className="bg-orange-50">
                    <tr>
                      <th className="px-4 py-2 text-left text-sm font-medium">Provider</th>
                      <th className="px-4 py-2 text-left text-sm font-medium">Remote Category</th>
                      <th className="px-4 py-2 text-left text-sm font-medium">Mapped To</th>
                      <th className="px-4 py-2 text-center text-sm font-medium">Confidence</th>
                      <th className="px-4 py-2 text-center text-sm font-medium">Override Rate</th>
                      <th className="px-4 py-2 text-left text-sm font-medium">Suggested Alias</th>
                    </tr>
                  </thead>
                  <tbody>
                    {needsAttention.map((stat) => (
                      <tr key={`${stat.provider}-${stat.remoteCategory}`} className="border-t">
                        <td className="px-4 py-2">{PROVIDER_NAMES[stat.provider] ?? stat.provider}</td>
                        <td className="px-4 py-2 font-mono text-sm">{stat.remoteCategory}</td>
                        <td className="px-4 py-2">
                          {stat.mappedCategory}
                          {stat.mappedSubcat && <span className="text-gray-500"> › {stat.mappedSubcat}</span>}
                        </td>
                        <td className="px-4 py-2 text-center">
                          <ConfidenceBadge confidence={stat.confidence} />
                        </td>
                        <td className="px-4 py-2 text-center">
                          <span className={`font-medium ${stat.overrideRate > 0.3 ? "text-red-600" : ""}`}>
                            {Math.round(stat.overrideRate * 100)}%
                          </span>
                        </td>
                        <td className="px-4 py-2">
                          <code className="bg-gray-100 px-2 py-1 rounded text-xs">
                            "{stat.remoteCategory.toLowerCase()}": "{stat.mappedCategory}"
                          </code>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* All Stats Table */}
          <h2 className="font-semibold mb-2">All Mappings ({sortedStats.length})</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full bg-white shadow rounded">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left text-sm font-medium">Provider</th>
                  <th className="px-4 py-2 text-left text-sm font-medium">Remote Category</th>
                  <th className="px-4 py-2 text-left text-sm font-medium">Mapped To</th>
                  <th className="px-4 py-2 text-center text-sm font-medium">Confidence</th>
                  <th className="px-4 py-2 text-center text-sm font-medium">Kept</th>
                  <th className="px-4 py-2 text-center text-sm font-medium">Overridden</th>
                  <th className="px-4 py-2 text-center text-sm font-medium">Override Rate</th>
                </tr>
              </thead>
              <tbody>
                {sortedStats.map((stat) => (
                  <tr key={`${stat.provider}-${stat.remoteCategory}`} className="border-t hover:bg-gray-50">
                    <td className="px-4 py-2">{PROVIDER_NAMES[stat.provider] ?? stat.provider}</td>
                    <td className="px-4 py-2 font-mono text-sm">{stat.remoteCategory}</td>
                    <td className="px-4 py-2">
                      {stat.mappedCategory}
                      {stat.mappedSubcat && <span className="text-gray-500"> › {stat.mappedSubcat}</span>}
                    </td>
                    <td className="px-4 py-2 text-center">
                      <ConfidenceBadge confidence={stat.confidence} />
                    </td>
                    <td className="px-4 py-2 text-center text-green-600">{stat.keepCount}</td>
                    <td className="px-4 py-2 text-center text-red-600">{stat.overrideCount}</td>
                    <td className="px-4 py-2 text-center">
                      {Math.round(stat.overrideRate * 100)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        /* Feedback View */
        <>
          <h2 className="font-semibold mb-2">Recent Seller Feedback ({feedback.length})</h2>
          <p className="text-sm text-gray-500 mb-4">
            Shows when sellers changed the auto-mapped category to something else.
          </p>
          <div className="overflow-x-auto">
            <table className="min-w-full bg-white shadow rounded">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left text-sm font-medium">Date</th>
                  <th className="px-4 py-2 text-left text-sm font-medium">Seller</th>
                  <th className="px-4 py-2 text-left text-sm font-medium">Provider</th>
                  <th className="px-4 py-2 text-left text-sm font-medium">Remote Category</th>
                  <th className="px-4 py-2 text-left text-sm font-medium">Auto-Mapped</th>
                  <th className="px-4 py-2 text-left text-sm font-medium">Seller Chose</th>
                </tr>
              </thead>
              <tbody>
                {feedback.map((f) => {
                  const wasOverridden = f.autoMapped !== f.sellerChosen;
                  return (
                    <tr
                      key={f.id}
                      className={`border-t ${wasOverridden ? "bg-yellow-50" : ""}`}
                    >
                      <td className="px-4 py-2 text-sm text-gray-600">
                        {new Date(f.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-2 text-sm">{f.memberName}</td>
                      <td className="px-4 py-2">{PROVIDER_NAMES[f.provider] ?? f.provider}</td>
                      <td className="px-4 py-2 font-mono text-sm">
                        {f.remoteCategory}
                        {f.remoteSubcat && <span className="text-gray-400"> › {f.remoteSubcat}</span>}
                      </td>
                      <td className="px-4 py-2">
                        {f.autoMapped}
                        {f.autoMappedSub && <span className="text-gray-400"> › {f.autoMappedSub}</span>}
                      </td>
                      <td className="px-4 py-2">
                        <span className={wasOverridden ? "font-medium text-orange-600" : ""}>
                          {f.sellerChosen}
                          {f.sellerChosenSub && <span className="text-gray-400"> › {f.sellerChosenSub}</span>}
                        </span>
                        {wasOverridden && (
                          <span className="ml-2 text-xs text-orange-500">Changed</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
