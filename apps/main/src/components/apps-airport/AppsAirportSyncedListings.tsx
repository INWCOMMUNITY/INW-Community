import type { ReactNode } from "react";

export type AppsAirportFilterTab = {
  id: string;
  label: string;
};

export function AppsAirportSyncedListings({
  summary,
  filterTabs,
  activeFilterId,
  onFilterChange,
  emptyState,
  tableHead,
  children,
}: {
  summary: ReactNode;
  filterTabs: AppsAirportFilterTab[];
  activeFilterId: string;
  onFilterChange: (id: string) => void;
  emptyState?: ReactNode;
  tableHead?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="mb-2">
      <div className="mb-3">
        <h2 className="font-bold" style={{ color: "var(--color-heading)" }}>
          Synced Listings
        </h2>
        <div className="text-sm text-neutral-600">{summary}</div>
      </div>

      {emptyState}

      {filterTabs.length > 0 ? (
        <div className="mb-3 flex flex-wrap gap-2">
          {filterTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`rounded-full border px-3 py-1 text-xs font-medium ${
                activeFilterId === tab.id
                  ? "border-[var(--color-primary)] bg-[var(--color-primary)] text-white"
                  : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50"
              }`}
              onClick={() => onFilterChange(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      ) : null}

      {tableHead ? (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm border-collapse">
            <thead>
              <tr className="border-b text-left" style={{ borderColor: "var(--color-primary)" }}>
                {tableHead}
              </tr>
            </thead>
            <tbody>{children}</tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
