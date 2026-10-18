"use client";

import {
  HANDLING_TIME_PRESETS,
  RETURN_LABEL_REASONS,
  handlingTimeBoldLine,
  showsFreeReturns,
  type HandlingTime,
  type ReasonLabelPayer,
  type ReturnLabelPayerMode,
  type ReturnLabelReason,
  type SellerReturnLabelPolicy,
} from "@/lib/seller-return-label-policy";

export function SellerPolicyQuestions({
  sellerName,
  policy,
  onChange,
  disabled,
}: {
  sellerName: string;
  policy: SellerReturnLabelPolicy;
  onChange: (next: SellerReturnLabelPolicy) => void;
  disabled?: boolean;
}) {
  const handlingLine = handlingTimeBoldLine(sellerName, policy.handlingTime);
  const freeReturns = showsFreeReturns(policy);
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-gray-900">Shipping</h2>
        <label htmlFor="handling-time" className="block text-sm font-medium text-gray-700">
          Handling time
        </label>
        <select
          id="handling-time"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
          value={policy.handlingTime ?? ""}
          disabled={disabled}
          onChange={(e) =>
            onChange({
              ...policy,
              handlingTime: (e.target.value || null) as HandlingTime | null,
            })
          }
        >
          <option value="">Choose a handling time</option>
          {HANDLING_TIME_PRESETS.map((preset) => (
            <option key={preset} value={preset}>
              {preset} business days
            </option>
          ))}
          <option value="custom">Custom — I’ll write it myself</option>
        </select>
        {handlingLine ? <p className="text-sm font-bold text-gray-900">{handlingLine}</p> : null}
        {policy.handlingTime === "custom" ? (
          <p className="text-sm text-gray-600">
            A custom handling time does not add the bold shipping line. Write the timing in your shipping policy.
          </p>
        ) : null}
      </div>

      <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-4">
        <h2 className="text-lg font-semibold text-gray-900">Return policy</h2>
        <p className="text-sm font-medium text-gray-700">Who pays for the return label?</p>
        <div className="space-y-2">
          {(
            [
              ["seller", "I do"],
              ["buyer", "The buyer"],
              ["by_reason", "By reason"],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="flex items-center gap-2 text-sm text-gray-800">
              <input
                type="radio"
                name="return-label-payer"
                checked={policy.returnLabelPayer === value}
                disabled={disabled}
                onChange={() => onChange({ ...policy, returnLabelPayer: value satisfies ReturnLabelPayerMode })}
              />
              {label}
            </label>
          ))}
        </div>
        {policy.returnLabelPayer === "by_reason" ? (
          <div className="space-y-2">
            {RETURN_LABEL_REASONS.map((reason) => (
              <div key={reason} className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm text-gray-800">{reason}</span>
                <select
                  aria-label={`${reason} return label payer`}
                  className="border border-gray-300 rounded-lg px-2 py-1 text-sm"
                  disabled={disabled}
                  value={policy.returnLabelPayerByReason[reason]}
                  onChange={(e) =>
                    onChange({
                      ...policy,
                      returnLabelPayerByReason: {
                        ...policy.returnLabelPayerByReason,
                        [reason]: e.target.value as ReasonLabelPayer,
                      },
                    })
                  }
                >
                  <option value="buyer">Buyer pays the label</option>
                  <option value="seller">I pay the label</option>
                </select>
              </div>
            ))}
          </div>
        ) : null}
        {freeReturns ? <p className="text-sm font-bold text-gray-900">FREE RETURNS</p> : null}
      </div>
    </div>
  );
}

export type { ReturnLabelReason };
