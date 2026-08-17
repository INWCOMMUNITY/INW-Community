"use client";

type ListingConditionToggleProps = {
  value: "new" | "used";
  onChange: (value: "new" | "used") => void;
  hint?: string;
};

export function ListingConditionToggle({ value, onChange, hint }: ListingConditionToggleProps) {
  return (
    <div>
      <span className="block text-sm font-medium text-gray-900 mb-2">Condition</span>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onChange("new")}
          className={`action-pill action-pill-sm ${value === "new" ? "btn-pill-primary" : "btn-pill-outline"}`}
        >
          New
        </button>
        <button
          type="button"
          onClick={() => onChange("used")}
          className={`action-pill action-pill-sm ${value === "used" ? "btn-pill-primary" : "btn-pill-outline"}`}
        >
          Used
        </button>
      </div>
      {hint ? <p className="text-xs text-gray-500 mt-2">{hint}</p> : null}
    </div>
  );
}
