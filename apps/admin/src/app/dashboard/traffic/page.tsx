"use client";

import { useState, useEffect } from "react";

const MAIN_URL = process.env.NEXT_PUBLIC_MAIN_SITE_URL || "http://localhost:3000";
const ADMIN_CODE = process.env.NEXT_PUBLIC_ADMIN_CODE ?? "NWC36481";

interface Analytics {
  pageviewsToday: number;
  pageviewsWeek: number;
  appOpensToday: number;
  appOpensWeek: number;
  appOpensBySource: Record<string, number>;
  webVitals: {
    lcp: number | null;
    fid: number | null;
    cls: number | null;
    sampleCount: number;
  };
  health: {
    database: boolean;
    stripe: boolean;
  };
}

export default function AdminTrafficPage() {
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${MAIN_URL}/api/admin/analytics`, {
      headers: { "x-admin-code": ADMIN_CODE },
    })
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-gray-500">Loading…</p>;
  if (!data) return <p className="text-gray-500">Failed to load analytics.</p>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Traffic & Health</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-gray-600 text-sm">Page views (24h)</p>
          <p className="text-2xl font-bold">{data.pageviewsToday.toLocaleString()}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-gray-600 text-sm">Page views (7 days)</p>
          <p className="text-2xl font-bold">{data.pageviewsWeek.toLocaleString()}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-gray-600 text-sm">App opens (24h)</p>
          <p className="text-2xl font-bold">{data.appOpensToday.toLocaleString()}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-gray-600 text-sm">App opens (7 days)</p>
          <p className="text-2xl font-bold">{data.appOpensWeek.toLocaleString()}</p>
        </div>
      </div>

      {Object.keys(data.appOpensBySource).length > 0 && (
        <div className="bg-white rounded-lg shadow p-4 mb-8">
          <h2 className="text-lg font-semibold mb-2">App opens by platform (7 days)</h2>
          <div className="flex gap-6">
            {Object.entries(data.appOpensBySource).map(([source, count]) => (
              <span key={source} className="text-sm">
                <strong className="capitalize">{source}:</strong> {count}
              </span>
            ))}
          </div>
          <p className="text-xs text-gray-500 mt-2">
            True download counts are in App Store Connect and Google Play Console.
          </p>
        </div>
      )}

      <div className="bg-white rounded-lg shadow p-4 mb-8">
        <h2 className="text-lg font-semibold mb-2">Core Web Vitals (7 days)</h2>
        {data.webVitals.sampleCount === 0 ? (
          <p className="text-gray-500 text-sm">No Web Vitals data yet. Visit the main site to generate metrics.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <p className="text-gray-600 text-sm">LCP (Largest Contentful Paint)</p>
              <p className="text-xl font-bold">
                {data.webVitals.lcp != null ? `${(data.webVitals.lcp / 1000).toFixed(2)}s` : "—"}
              </p>
              <p className="text-xs text-gray-500">Good: &lt;2.5s</p>
            </div>
            <div>
              <p className="text-gray-600 text-sm">FID (First Input Delay)</p>
              <p className="text-xl font-bold">
                {data.webVitals.fid != null ? `${data.webVitals.fid.toFixed(0)}ms` : "—"}
              </p>
              <p className="text-xs text-gray-500">Good: &lt;100ms</p>
            </div>
            <div>
              <p className="text-gray-600 text-sm">CLS (Cumulative Layout Shift)</p>
              <p className="text-xl font-bold">{data.webVitals.cls != null ? data.webVitals.cls.toFixed(3) : "—"}</p>
              <p className="text-xs text-gray-500">Good: &lt;0.1</p>
            </div>
          </div>
        )}
      </div>

      <div className="bg-white rounded-lg shadow p-4">
        <h2 className="text-lg font-semibold mb-2">Health</h2>
        <div className="flex gap-6">
          <span
            className={`text-sm font-medium ${data.health.database ? "text-green-600" : "text-red-600"}`}
          >
            Database: {data.health.database ? "OK" : "Error"}
          </span>
          <span
            className={`text-sm font-medium ${data.health.stripe ? "text-green-600" : "text-amber-600"}`}
          >
            Stripe: {data.health.stripe ? "Configured" : "Not configured"}
          </span>
        </div>
      </div>
    </div>
  );
}
