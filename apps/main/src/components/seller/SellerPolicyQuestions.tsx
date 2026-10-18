"use client";

import {
  BUYER_FAULT_REASONS,
  HANDLING_TIME_PRESETS,
  SELLER_FAULT_REASONS,
  applyReasonGroup,
  reasonGroupSelection,
  type HandlingTime,
  type ReasonLabelPayer,
  type ReturnLabelPayerMode,
  type ReturnLabelReason,
  type SellerReturnLabelPolicy,
} from "@/lib/seller-return-label-policy";

export function SellerPolicyQuestions({
  policy,
  onChange,
  disabled,
}: {
  policy: SellerReturnLabelPolicy;
  onChange: (next: SellerReturnLabelPolicy) => void;
  disabled?: boolean;
}) {
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
        {policy.handlingTime === "custom" ? (
          <p className="text-sm text-gray-600">
            A custom handling time does not add the bold shipping line. Write the timing in your Shipping Policy.
          </p>
        ) : null}
      </div>

      <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-4">
        <h2 className="text-lg font-semibold text-gray-900">Return Policy</h2>
        <p className="text-sm font-medium text-gray-700">Who pays for the return label?</p>
        <div className="space-y-2">
          {(
            [
              ["seller", "I do"],
              ["buyer", "The Buyer"],
              ["by_reason", "By Reason"],
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
          <div className="space-y-4">
            <ReasonGroup
              title="Buyer fault"
              reasons={BUYER_FAULT_REASONS}
              policy={policy}
              disabled={disabled}
              onChange={onChange}
            />
            <ReasonGroup
              title="Seller fault"
              reasons={SELLER_FAULT_REASONS}
              policy={policy}
              disabled={disabled}
              onChange={onChange}
            />
            <div className="space-y-2">
              <p className="text-sm font-semibold text-gray-900">Other</p>
              <div className="flex flex-wrap gap-3">
                {(
                  [
                    ["buyer", "Buyer pays"],
                    ["seller", "I pay"],
                    ["later", "Decide at that time"],
                  ] as const
                ).map(([value, label]) => (
                  <label key={value} className="flex items-center gap-2 text-sm text-gray-800">
                    <input
                      type="checkbox"
                      checked={policy.returnLabelPayerByReason.Other === value}
                      disabled={disabled}
                      onChange={() =>
                        onChange({
                          ...policy,
                          returnLabelPayerByReason: { ...policy.returnLabelPayerByReason, Other: value },
                        })
                      }
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ReasonGroup({
  title,
  reasons,
  policy,
  disabled,
  onChange,
}: {
  title: string;
  reasons: readonly ReturnLabelReason[];
  policy: SellerReturnLabelPolicy;
  disabled?: boolean;
  onChange: (next: SellerReturnLabelPolicy) => void;
}) {
  const selected = reasonGroupSelection(policy.returnLabelPayerByReason, reasons);
  const setGroup = (payer: ReasonLabelPayer) =>
    onChange({
      ...policy,
      returnLabelPayerByReason: applyReasonGroup(policy.returnLabelPayerByReason, reasons, payer),
    });
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-gray-900">{title}</p>
        <div className="flex gap-3">
          {(
            [
              ["buyer", "Buyer pays"],
              ["seller", "I pay"],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="flex items-center gap-2 text-sm text-gray-800">
              <input
                type="checkbox"
                checked={selected === value}
                disabled={disabled}
                onChange={() => setGroup(value)}
              />
              {label}
            </label>
          ))}
        </div>
      </div>
      <div className="space-y-2">
        {reasons.map((reason) => (
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
              <option value="buyer">Buyer pays</option>
              <option value="seller">I pay</option>
            </select>
          </div>
        ))}
      </div>
    </div>
  );
}

export function PolicyPreviewField({
  id,
  label,
  lead,
  leads,
  value,
  onChange,
  placeholder,
  disabled,
}: {
  id: string;
  label: string;
  lead?: string | null;
  leads?: readonly (string | null | undefined)[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const lines = [...(leads ?? []), lead].filter((line): line is string => Boolean(line));
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-sm font-medium text-gray-700">
        {label}
      </label>
      <div className="rounded-lg border border-gray-300 bg-white">
        {lines.map((line) => (
          <p key={line} className="px-3 pt-2 text-sm font-bold text-gray-900">
            {line}
          </p>
        ))}
        <textarea
          id={id}
          rows={4}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          placeholder={lines.length ? "Type under this line." : placeholder}
          className="w-full resize-y border-0 bg-transparent px-3 py-2 text-sm text-gray-900 placeholder-gray-500 outline-none"
        />
      </div>
    </div>
  );
}

export type { ReturnLabelReason };
