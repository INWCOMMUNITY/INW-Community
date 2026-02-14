"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useLockBodyScroll } from "@/lib/scroll-lock";

export interface PickupDetails {
  firstName: string;
  lastName: string;
  phone: string;
  email?: string;
  preferredPickupTime?: string;
  note?: string;
  termsAcceptedAt?: string;
}

interface PickupTermsModalProps {
  open: boolean;
  onClose: () => void;
  policyText?: string | null;
  initialForm?: Partial<PickupDetails> | null;
  onSave: (form: PickupDetails & { termsAcceptedAt?: string }) => void;
}

const emptyForm: PickupDetails = {
  firstName: "",
  lastName: "",
  phone: "",
  email: "",
  preferredPickupTime: "",
  note: "",
};

export function PickupTermsModal({
  open,
  onClose,
  policyText,
  initialForm,
  onSave,
}: PickupTermsModalProps) {
  const { data: session } = useSession();
  const [form, setForm] = useState<PickupDetails>({ ...emptyForm });
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [validationError, setValidationError] = useState("");

  useEffect(() => {
    if (open) {
      setForm({
        firstName: initialForm?.firstName ?? "",
        lastName: initialForm?.lastName ?? "",
        phone: initialForm?.phone ?? "",
        email: initialForm?.email ?? "",
        preferredPickupTime: initialForm?.preferredPickupTime ?? "",
        note: initialForm?.note ?? "",
      });
      setTermsAccepted(!!initialForm?.termsAcceptedAt);
      setValidationError("");
    }
  }, [open, initialForm]);

  useLockBodyScroll(open);

  function handleAutofill() {
    fetch("/api/me")
      .then((r) => r.json())
      .then((d) => {
        if (d?.firstName) setForm((f) => ({ ...f, firstName: d.firstName }));
        if (d?.lastName) setForm((f) => ({ ...f, lastName: d.lastName }));
        if (d?.phone) setForm((f) => ({ ...f, phone: d.phone }));
        if (d?.email) setForm((f) => ({ ...f, email: d.email }));
      })
      .catch(() => {});
  }

  function handleSave() {
    setValidationError("");
    const f = form;
    const hasPolicy = !!policyText && String(policyText).trim();
    const ok =
      f.firstName.trim() &&
      f.lastName.trim() &&
      f.phone.trim() &&
      (!hasPolicy || termsAccepted);
    if (ok) {
      onSave({
        ...f,
        termsAcceptedAt: hasPolicy ? new Date().toISOString() : undefined,
      });
      onClose();
    } else {
      setValidationError(
        hasPolicy
          ? "Please fill all required fields and agree to the terms."
          : "Please fill all required fields."
      );
    }
  }

  if (!open) return null;

  const hasPolicy = !!policyText && String(policyText).trim();

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 overflow-hidden"
      style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Pick Up Form"
    >
      <div
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-lg shadow-xl"
        style={{
          backgroundColor: "var(--color-background)",
          border: "1px solid var(--color-primary)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6">
          <h2
            className="text-xl font-semibold mb-4"
            style={{ fontFamily: "var(--font-heading)", color: "var(--color-heading)" }}
          >
            Pick Up Form
          </h2>
          {policyText && (
            <div
              className="mb-4 p-3 rounded border text-sm whitespace-pre-wrap"
              style={{
                backgroundColor: "var(--color-section-alt)",
                borderColor: "var(--color-primary)",
                color: "var(--color-text)",
              }}
            >
              <strong>Seller&apos;s pickup terms:</strong>
              <div className="mt-1">{policyText}</div>
            </div>
          )}
          {session?.user && (
            <button
              type="button"
              onClick={handleAutofill}
              className="text-sm mb-4 hover:underline"
              style={{ color: "var(--color-link)" }}
            >
              Autofill from my profile
            </button>
          )}
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-sm font-medium mb-0.5" style={{ color: "var(--color-text)" }}>
                  First name *
                </label>
                <input
                  type="text"
                  value={form.firstName}
                  onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
                  className="w-full border rounded px-3 py-2 text-sm"
                  style={{ borderColor: "var(--color-primary)" }}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-0.5" style={{ color: "var(--color-text)" }}>
                  Last name *
                </label>
                <input
                  type="text"
                  value={form.lastName}
                  onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
                  className="w-full border rounded px-3 py-2 text-sm"
                  style={{ borderColor: "var(--color-primary)" }}
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-0.5" style={{ color: "var(--color-text)" }}>
                Phone *
              </label>
              <input
                type="tel"
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                className="w-full border rounded px-3 py-2 text-sm"
                style={{ borderColor: "var(--color-primary)" }}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-0.5" style={{ color: "var(--color-text)" }}>
                Email (optional)
              </label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                className="w-full border rounded px-3 py-2 text-sm"
                style={{ borderColor: "var(--color-primary)" }}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-0.5" style={{ color: "var(--color-text)" }}>
                Preferable Time of Pick Up
              </label>
              <input
                type="text"
                placeholder="e.g. Weekday mornings, Saturday after 2pm"
                value={form.preferredPickupTime ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, preferredPickupTime: e.target.value }))}
                className="w-full border rounded px-3 py-2 text-sm"
                style={{ borderColor: "var(--color-primary)" }}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-0.5" style={{ color: "var(--color-text)" }}>
                Note to seller (optional)
              </label>
              <textarea
                value={form.note ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                className="w-full border rounded px-3 py-2 text-sm"
                style={{ borderColor: "var(--color-primary)" }}
                rows={2}
              />
            </div>
            {hasPolicy && (
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={termsAccepted}
                  onChange={(e) => setTermsAccepted(e.target.checked)}
                  className="rounded mt-1"
                  style={{ accentColor: "var(--color-primary)" }}
                />
                <span className="text-sm" style={{ color: "var(--color-text)" }}>
                  I understand and agree to the seller&apos;s pickup terms.
                </span>
              </label>
            )}
          </div>
          {validationError && (
            <p className="text-sm mt-3" style={{ color: "var(--color-primary)" }}>
              {validationError}
            </p>
          )}
          <div className="flex gap-2 mt-6">
            <button type="button" onClick={handleSave} className="btn">
              Save &amp; continue
            </button>
            <button
              type="button"
              onClick={onClose}
              className="border rounded px-4 py-2 hover:opacity-90"
              style={{
                borderColor: "var(--color-primary)",
                color: "var(--color-text)",
                backgroundColor: "var(--color-background)",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
