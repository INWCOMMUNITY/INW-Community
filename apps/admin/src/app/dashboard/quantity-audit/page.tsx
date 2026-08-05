"use client";

import { useState, useEffect } from "react";

const MAIN_URL = process.env.NEXT_PUBLIC_MAIN_SITE_URL || "http://localhost:3000";
const ADMIN_CODE = process.env.NEXT_PUBLIC_ADMIN_CODE ?? "NWC36481";

interface AuditLogEntry {
  id: string;
  storeItemId: string;
  memberId: string;
  provider: string;
  previousQty: number;
  newQty: number;
  delta: number;
  reason: string;
  externalEventId: string | null;
  orderId: string | null;
  variantValue: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  memberName: string;
  memberEmail: string;
  itemTitle: string;
}

const REASON_LABELS: Record<string, string> = {
  sale: "Sale",
  restock: "Restock",
  sync_pull: "Synced from Channel",
  manual_edit: "Manual Edit",
  refund: "Refund/Cancel",
  bulk_edit: "Bulk Edit",
  import: "Import",
  sync_push: "Pushed to Channel",
};

const PROVIDER_NAMES: Record<string, string> = {
  inwc: "NWC Store",
  etsy: "Etsy",
  ebay: "eBay",
  shopify: "Shopify",
  wix: "Wix",
};

function formatTime(dateStr: string) {
  const date = new Date(dateStr);
  return date.toLocaleString();
}

export default function QuantityAuditPage() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  // Filters
  const [search, setSearch] = useState("");
  const [filterProvider, setFilterProvider] = useState("");
  const [filterReason, setFilterReason] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [offset, setOffset] = useState(0);
  const limit = 50;

  async function fetchData(newOffset = 0) {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("limit", limit.toString());
      params.set("offset", newOffset.toString());
      if (filterProvider) params.set("provider", filterProvider);
      if (filterReason) params.set("reason", filterReason);
      if (dateFrom) params.set("dateFrom", new Date(dateFrom).toISOString());
      if (dateTo) params.set("dateTo", new Date(dateTo + "T23:59:59").toISOString());

      const res = await fetch(`${MAIN_URL}/api/admin/quantity-audit?${params}`, {
        headers: { "x-admin-code": ADMIN_CODE },
      });
      const json = await res.json();
      setLogs(json.logs ?? []);
      setTotal(json.total ?? 0);
      setOffset(newOffset);
    } catch (e) {
      console.error("Failed to fetch audit log:", e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchData(0);
  }, [filterProvider, filterReason, dateFrom, dateTo]);

  async function handleExportCSV() {
    setExporting(true);
    try {
      const params = new URLSearchParams();
      params.set("format", "csv");
      params.set("limit", "10000");
      if (filterProvider) params.set("provider", filterProvider);
      if (filterReason) params.set("reason", filterReason);
      if (dateFrom) params.set("dateFrom", new Date(dateFrom).toISOString());
      if (dateTo) params.set("dateTo", new Date(dateTo + "T23:59:59").toISOString());

      const res = await fetch(`${MAIN_URL}/api/admin/quantity-audit?${params}`, {
        headers: { "x-admin-code": ADMIN_CODE },
      });
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `quantity-audit-${new Date().toISOString().split("T")[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (e) {
      alert("Failed to export CSV");
    } finally {
      setExporting(false);
    }
  }

  const filtered = logs.filter((log) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      log.memberName.toLowerCase().includes(q) ||
      log.memberEmail.toLowerCase().includes(q) ||
      log.itemTitle.toLowerCase().includes(q)
    );
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Quantity Audit Log</h1>
        <button
          onClick={handleExportCSV}
          disabled={exporting}
          className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
        >
          {exporting ? "Exporting…" : "Export CSV"}
        </button>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">Total Records</p>
          <p className="text-2xl font-bold">{total}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">Sales</p>
          <p className="text-2xl font-bold text-red-600">
            {logs.filter((l) => l.reason === "sale").length}
          </p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">Manual Edits</p>
          <p className="text-2xl font-bold text-blue-600">
            {logs.filter((l) => l.reason === "manual_edit").length}
          </p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">Sync Operations</p>
          <p className="text-2xl font-bold text-purple-600">
            {logs.filter((l) => l.reason === "sync_pull" || l.reason === "sync_push").length}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow p-4 mb-6">
        <div className="flex flex-wrap gap-4">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, email, or item…"
            className="border rounded px-3 py-2 text-sm w-64"
          />
          <select
            value={filterProvider}
            onChange={(e) => setFilterProvider(e.target.value)}
            className="border rounded px-3 py-2 text-sm"
          >
            <option value="">All Providers</option>
            <option value="inwc">NWC Store</option>
            <option value="etsy">Etsy</option>
            <option value="ebay">eBay</option>
            <option value="shopify">Shopify</option>
            <option value="wix">Wix</option>
          </select>
          <select
            value={filterReason}
            onChange={(e) => setFilterReason(e.target.value)}
            className="border rounded px-3 py-2 text-sm"
          >
            <option value="">All Reasons</option>
            <option value="sale">Sale</option>
            <option value="manual_edit">Manual Edit</option>
            <option value="bulk_edit">Bulk Edit</option>
            <option value="sync_pull">Sync Pull</option>
            <option value="refund">Refund</option>
          </select>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500">From:</span>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="border rounded px-3 py-2 text-sm"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500">To:</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="border rounded px-3 py-2 text-sm"
            />
          </div>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <p className="text-gray-500">Loading…</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="min-w-full bg-white shadow rounded">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left text-sm font-medium">Date</th>
                  <th className="px-4 py-2 text-left text-sm font-medium">Seller</th>
                  <th className="px-4 py-2 text-left text-sm font-medium">Item</th>
                  <th className="px-4 py-2 text-left text-sm font-medium">Provider</th>
                  <th className="px-4 py-2 text-left text-sm font-medium">Reason</th>
                  <th className="px-4 py-2 text-center text-sm font-medium">Change</th>
                  <th className="px-4 py-2 text-left text-sm font-medium">Variant</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((log) => (
                  <tr key={log.id} className="border-t hover:bg-gray-50">
                    <td className="px-4 py-2 text-sm text-gray-600">
                      {formatTime(log.createdAt)}
                    </td>
                    <td className="px-4 py-2">
                      <div className="font-medium text-sm">{log.memberName}</div>
                      <div className="text-xs text-gray-500">{log.memberEmail}</div>
                    </td>
                    <td className="px-4 py-2 text-sm max-w-xs truncate">
                      {log.itemTitle}
                    </td>
                    <td className="px-4 py-2 text-sm">
                      {PROVIDER_NAMES[log.provider] ?? log.provider}
                    </td>
                    <td className="px-4 py-2">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${
                        log.reason === "sale" ? "bg-red-100 text-red-800" :
                        log.reason === "refund" ? "bg-green-100 text-green-800" :
                        log.reason === "sync_pull" ? "bg-purple-100 text-purple-800" :
                        "bg-gray-100 text-gray-800"
                      }`}>
                        {REASON_LABELS[log.reason] ?? log.reason}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-center">
                      <span className={`font-bold ${log.delta > 0 ? "text-green-600" : "text-red-600"}`}>
                        {log.delta > 0 ? "+" : ""}{log.delta}
                      </span>
                      <span className="text-xs text-gray-500 ml-2">
                        ({log.previousQty} → {log.newQty})
                      </span>
                    </td>
                    <td className="px-4 py-2 text-sm text-gray-500">
                      {log.variantValue ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between mt-4">
            <p className="text-sm text-gray-500">
              Showing {offset + 1} - {Math.min(offset + limit, total)} of {total}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => fetchData(Math.max(0, offset - limit))}
                disabled={offset === 0}
                className="px-3 py-1 border rounded text-sm disabled:opacity-50"
              >
                Previous
              </button>
              <button
                onClick={() => fetchData(offset + limit)}
                disabled={offset + limit >= total}
                className="px-3 py-1 border rounded text-sm disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
