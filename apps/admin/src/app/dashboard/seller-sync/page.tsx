"use client";

import { adminFetch } from "@/lib/admin-fetch";

import { useState, useEffect } from "react";

const MAIN_URL = process.env.NEXT_PUBLIC_MAIN_SITE_URL || "http://localhost:3000";

interface SellerConnection {
  connectionId: string;
  memberId: string;
  firstName: string;
  lastName: string;
  email: string;
  provider: string;
  status: string;
  linkedItems: number;
  errors: number;
  lastSyncAt: string | null;
  lastError: string | null;
}

interface SyncHealthData {
  totalConnections: number;
  healthyConnections: number;
  warningConnections: number;
  errorConnections: number;
  totalLinkedItems: number;
  itemsWithErrors: number;
  errorLogs24h: number;
  byProvider: Record<string, { connections: number; errors: number }>;
  sellers: SellerConnection[];
}

const PROVIDER_NAMES: Record<string, string> = {
  etsy: "Etsy",
  ebay: "eBay",
  shopify: "Shopify",
  wix: "Wix",
};

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active: "bg-green-100 text-green-800",
    error: "bg-red-100 text-red-800",
    disconnected: "bg-gray-100 text-gray-800",
    pending: "bg-yellow-100 text-yellow-800",
  };
  return (
    <span className={`px-2 py-1 rounded text-xs font-medium ${colors[status] ?? colors.pending}`}>
      {status}
    </span>
  );
}

function formatTime(dateStr: string | null) {
  if (!dateStr) return "Never";
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  if (diff < 60 * 1000) return "Just now";
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60 / 1000)}m ago`;
  if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 60 / 60 / 1000)}h ago`;
  return date.toLocaleDateString();
}

export default function SellerSyncPage() {
  const [data, setData] = useState<SyncHealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterProvider, setFilterProvider] = useState<string>("");
  const [filterStatus, setFilterStatus] = useState<string>("");
  const [retrying, setRetrying] = useState<string | null>(null);

  async function fetchData() {
    try {
      const res = await adminFetch(`${MAIN_URL}/api/admin/sync-health`, {
        });
      const json = await res.json();
      setData(json);
    } catch (e) {
      console.error("Failed to fetch sync health:", e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchData();
  }, []);

  async function handleRetry(connectionId: string) {
    setRetrying(connectionId);
    try {
      const res = await adminFetch(`${MAIN_URL}/api/admin/sync-health`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ connectionId }),
      });
      const result = await res.json();
      alert(`Scheduled retry for ${result.retriedCount} items`);
      fetchData();
    } catch (e) {
      alert("Failed to retry sync");
    } finally {
      setRetrying(null);
    }
  }

  if (loading) return <p className="text-gray-500">Loading…</p>;
  if (!data) return <p className="text-red-500">Failed to load sync health data</p>;

  const filtered = data.sellers.filter((s) => {
    if (search) {
      const q = search.toLowerCase();
      if (
        !s.firstName.toLowerCase().includes(q) &&
        !s.lastName.toLowerCase().includes(q) &&
        !s.email.toLowerCase().includes(q)
      ) {
        return false;
      }
    }
    if (filterProvider && s.provider !== filterProvider) return false;
    if (filterStatus && s.status !== filterStatus) return false;
    return true;
  });

  const errorSellers = filtered.filter((s) => s.errors > 0 || s.status === "error");

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Channel Sync Health</h1>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">Total Connections</p>
          <p className="text-2xl font-bold">{data.totalConnections}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">Healthy</p>
          <p className="text-2xl font-bold text-green-600">{data.healthyConnections}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">With Issues</p>
          <p className="text-2xl font-bold text-yellow-600">
            {data.warningConnections + data.errorConnections}
          </p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">Errors (24h)</p>
          <p className="text-2xl font-bold text-red-600">{data.errorLogs24h}</p>
        </div>
      </div>

      {/* Provider Breakdown */}
      <div className="bg-white rounded-lg shadow p-4 mb-8">
        <h2 className="font-semibold mb-4">By Provider</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Object.entries(data.byProvider).map(([provider, stats]) => (
            <div key={provider} className="border rounded p-3">
              <p className="font-medium">{PROVIDER_NAMES[provider] ?? provider}</p>
              <p className="text-sm text-gray-500">
                {stats.connections} connections, {stats.errors} errors
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-4 mb-4">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or email…"
          className="border rounded px-3 py-2 text-sm w-64"
        />
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
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="border rounded px-3 py-2 text-sm"
        >
          <option value="">All Statuses</option>
          <option value="active">Active</option>
          <option value="error">Error</option>
          <option value="disconnected">Disconnected</option>
        </select>
      </div>

      {/* Sellers with Issues */}
      {errorSellers.length > 0 && (
        <div className="mb-6">
          <h2 className="font-semibold text-red-600 mb-2">
            ⚠️ Sellers Needing Attention ({errorSellers.length})
          </h2>
          <div className="overflow-x-auto">
            <table className="min-w-full bg-white shadow rounded">
              <thead className="bg-red-50">
                <tr>
                  <th className="px-4 py-2 text-left text-sm font-medium">Seller</th>
                  <th className="px-4 py-2 text-left text-sm font-medium">Provider</th>
                  <th className="px-4 py-2 text-left text-sm font-medium">Status</th>
                  <th className="px-4 py-2 text-left text-sm font-medium">Linked</th>
                  <th className="px-4 py-2 text-left text-sm font-medium">Errors</th>
                  <th className="px-4 py-2 text-left text-sm font-medium">Last Error</th>
                  <th className="px-4 py-2 text-left text-sm font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {errorSellers.map((s) => (
                  <tr key={s.connectionId} className="border-t">
                    <td className="px-4 py-2">
                      <div className="font-medium">{s.firstName} {s.lastName}</div>
                      <div className="text-sm text-gray-500">{s.email}</div>
                    </td>
                    <td className="px-4 py-2">{PROVIDER_NAMES[s.provider] ?? s.provider}</td>
                    <td className="px-4 py-2"><StatusBadge status={s.status} /></td>
                    <td className="px-4 py-2">{s.linkedItems}</td>
                    <td className="px-4 py-2 text-red-600 font-medium">{s.errors}</td>
                    <td className="px-4 py-2 text-sm text-gray-600 max-w-xs truncate">
                      {s.lastError ?? "—"}
                    </td>
                    <td className="px-4 py-2">
                      {s.errors > 0 && (
                        <button
                          onClick={() => handleRetry(s.connectionId)}
                          disabled={retrying === s.connectionId}
                          className="px-3 py-1 bg-blue-500 text-white rounded text-sm hover:bg-blue-600 disabled:opacity-50"
                        >
                          {retrying === s.connectionId ? "…" : "Retry All"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* All Connections Table */}
      <h2 className="font-semibold mb-2">All Connections ({filtered.length})</h2>
      <div className="overflow-x-auto">
        <table className="min-w-full bg-white shadow rounded">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left text-sm font-medium">Seller</th>
              <th className="px-4 py-2 text-left text-sm font-medium">Provider</th>
              <th className="px-4 py-2 text-left text-sm font-medium">Status</th>
              <th className="px-4 py-2 text-left text-sm font-medium">Linked Items</th>
              <th className="px-4 py-2 text-left text-sm font-medium">Errors</th>
              <th className="px-4 py-2 text-left text-sm font-medium">Last Sync</th>
              <th className="px-4 py-2 text-left text-sm font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => (
              <tr key={s.connectionId} className="border-t hover:bg-gray-50">
                <td className="px-4 py-2">
                  <div className="font-medium">{s.firstName} {s.lastName}</div>
                  <div className="text-sm text-gray-500">{s.email}</div>
                </td>
                <td className="px-4 py-2">{PROVIDER_NAMES[s.provider] ?? s.provider}</td>
                <td className="px-4 py-2"><StatusBadge status={s.status} /></td>
                <td className="px-4 py-2">{s.linkedItems}</td>
                <td className="px-4 py-2">{s.errors > 0 ? <span className="text-red-600">{s.errors}</span> : "0"}</td>
                <td className="px-4 py-2 text-sm text-gray-600">{formatTime(s.lastSyncAt)}</td>
                <td className="px-4 py-2">
                  {s.errors > 0 && (
                    <button
                      onClick={() => handleRetry(s.connectionId)}
                      disabled={retrying === s.connectionId}
                      className="px-3 py-1 bg-blue-500 text-white rounded text-sm hover:bg-blue-600 disabled:opacity-50"
                    >
                      {retrying === s.connectionId ? "…" : "Retry"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
