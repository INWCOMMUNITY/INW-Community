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
  mobileList,
}: {
  summary: ReactNode;
  filterTabs: AppsAirportFilterTab[];
  activeFilterId: string;
  onFilterChange: (id: string) => void;
  emptyState?: ReactNode;
  tableHead?: ReactNode;
  /** Desktop table body rows. */
  children?: ReactNode;
  /** Mobile stacked cards (shown below md). */
  mobileList?: ReactNode;
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

      {mobileList ? (
        <ul className="md:hidden relative left-1/2 w-screen max-w-[100vw] -translate-x-1/2 divide-y divide-neutral-200 border-y border-neutral-200">
          {mobileList}
        </ul>
      ) : null}

      {tableHead ? (
        <div
          className={`${mobileList ? "hidden md:block " : ""}overflow-x-auto`}
        >
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
