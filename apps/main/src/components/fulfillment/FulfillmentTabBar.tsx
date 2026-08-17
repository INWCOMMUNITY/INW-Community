"use client";

import type { FulfillmentTabKey } from "@/lib/store-order-fulfillment";
import type { FulfillmentTabCounts } from "./types";

const TABS: { key: FulfillmentTabKey; label: string; countKey?: keyof FulfillmentTabCounts }[] = [
  { key: "ship", label: "Ship", countKey: "ship" },
  { key: "pickups", label: "Pickups", countKey: "pickups" },
  { key: "deliveries", label: "Deliveries", countKey: "deliveries" },
  { key: "history", label: "History" },
];

type FulfillmentTabBarProps = {
  activeTab: FulfillmentTabKey;
  onTabChange: (tab: FulfillmentTabKey) => void;
  counts?: Partial<FulfillmentTabCounts>;
};

export function FulfillmentTabBar({ activeTab, onTabChange, counts }: FulfillmentTabBarProps) {
  return (
    <div className="flex gap-1 mb-6 border-b border-gray-200 overflow-x-auto">
      {TABS.map((t) => {
        const count =
          t.countKey && counts?.[t.countKey] != null && counts[t.countKey]! > 0
            ? counts[t.countKey]
            : null;
        const active = activeTab === t.key;
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => onTabChange(t.key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px whitespace-nowrap flex items-center gap-2 ${
              active
                ? "border-[var(--color-primary)] text-[var(--color-primary)]"
                : "border-transparent text-gray-600 hover:text-gray-900"
            }`}
          >
            {t.label}
            {count != null ? (
              <span
                className="text-[11px] font-semibold px-1.5 py-0.5 rounded-full min-w-[1.25rem] text-center"
                style={{
                  backgroundColor: active ? "var(--color-primary)" : "var(--color-section-alt)",
                  color: active ? "#fff" : "var(--color-primary)",
                }}
              >
                {count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
