"use client";

export function ReturnLabelDueTag() {
  return (
    <span
      className="inline-flex w-full items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold text-white"
      style={{ backgroundColor: "#6b2430" }}
    >
      Due
    </span>
  );
}

export function SellerReturnRefundChoiceModal({
  open,
  busy,
  error,
  onRefundNow,
  onRefundWhenArrives,
}: {
  open: boolean;
  busy: boolean;
  error: string | null;
  onRefundNow: () => void;
  onRefundWhenArrives: () => void;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="return-refund-timing-title"
    >
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
        <h3 id="return-refund-timing-title" className="text-lg font-bold mb-2">
          When should this refund go out?
        </h3>
        <p className="text-sm text-gray-600 mb-4">
          The return label was sent. Choose one to continue.
        </p>
        {error ? <p className="text-sm text-red-700 mb-3">{error}</p> : null}
        <div className="flex flex-col gap-2">
          <button type="button" className="btn text-sm py-2 px-3" disabled={busy} onClick={onRefundNow}>
            {busy ? "Working…" : "Refund Now"}
          </button>
          <button
            type="button"
            className="text-sm py-2 px-3 border rounded-lg"
            disabled={busy}
            onClick={onRefundWhenArrives}
          >
            Refund when item arrives
          </button>
        </div>
      </div>
    </div>
  );
}
