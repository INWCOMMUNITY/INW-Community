"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useLockBodyScroll } from "@/lib/scroll-lock";

export interface LocalDeliveryDetails {
  firstName: string;
  lastName: string;
  phone: string;
  deliveryAddress: { street: string; city: string; state: string; zip: string };
  note?: string;
  termsAcceptedAt?: string;
}

interface LocalDeliveryModalProps {
  open: boolean;
  onClose: () => void;
  policyText?: string | null;
  initialForm?: Partial<LocalDeliveryDetails> | null;
  onSave: (form: LocalDeliveryDetails & { termsAcceptedAt?: string }) => void;
}

const emptyForm: LocalDeliveryDetails = {
  firstName: "",
  lastName: "",
  phone: "",
  deliveryAddress: { street: "", city: "", state: "", zip: "" },
  note: "",
};

export function LocalDeliveryModal({
  open,
  onClose,
  policyText,
  initialForm,
  onSave,
}: LocalDeliveryModalProps) {
  const { data: session } = useSession();
  const [form, setForm] = useState<LocalDeliveryDetails>({ ...emptyForm });
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [validationError, setValidationError] = useState("");

  useEffect(() => {
    if (open) {
      setForm({
        firstName: initialForm?.firstName ?? "",
        lastName: initialForm?.lastName ?? "",
        phone: initialForm?.phone ?? "",
        deliveryAddress: {
          street: initialForm?.deliveryAddress?.street ?? "",
          city: initialForm?.deliveryAddress?.city ?? "",
          state: initialForm?.deliveryAddress?.state ?? "",
          zip: initialForm?.deliveryAddress?.zip ?? "",
        },
        note: initialForm?.note ?? "",
      });
      setTermsAccepted(false);
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
        const addr = d?.deliveryAddress;
        if (addr && typeof addr === "object") {
          setForm((f) => ({
            ...f,
            deliveryAddress: {
              street: addr.street ?? "",
              city: addr.city ?? "",
              state: addr.state ?? "",
              zip: addr.zip ?? "",
            },
          }));
        }
      })
      .catch(() => {});
  }

  function handleSave() {
    setValidationError("");
    const f = form;
    const ok =
      f.firstName.trim() &&
      f.lastName.trim() &&
      f.phone.trim() &&
      f.deliveryAddress.street.trim() &&
      f.deliveryAddress.city.trim() &&
      f.deliveryAddress.state.trim() &&
      f.deliveryAddress.zip.trim() &&
      termsAccepted;
    if (ok) {
      onSave({
        ...f,
        termsAcceptedAt: new Date().toISOString(),
      });
      onClose();
    } else {
      setValidationError("Please fill all required fields and agree to the terms.");
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 overflow-hidden"
      style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Local Delivery details"
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
            Local Delivery – your details
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
              <strong>Seller&apos;s delivery terms:</strong>
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
                Delivery address *
              </label>
              <input
                type="text"
                placeholder="Street"
                value={form.deliveryAddress.street}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    deliveryAddress: { ...f.deliveryAddress, street: e.target.value },
                  }))
                }
                className="w-full border rounded px-3 py-2 text-sm mb-2"
                style={{ borderColor: "var(--color-primary)" }}
              />
              <div className="grid grid-cols-3 gap-2">
                <input
                  type="text"
                  placeholder="City"
                  value={form.deliveryAddress.city}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      deliveryAddress: { ...f.deliveryAddress, city: e.target.value },
                    }))
                  }
                  className="border rounded px-3 py-2 text-sm"
                  style={{ borderColor: "var(--color-primary)" }}
                />
                <input
                  type="text"
                  placeholder="State"
                  value={form.deliveryAddress.state}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      deliveryAddress: { ...f.deliveryAddress, state: e.target.value },
                    }))
                  }
                  className="border rounded px-3 py-2 text-sm"
                  style={{ borderColor: "var(--color-primary)" }}
                />
                <input
                  type="text"
                  placeholder="ZIP"
                  value={form.deliveryAddress.zip}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      deliveryAddress: { ...f.deliveryAddress, zip: e.target.value },
                    }))
                  }
                  className="border rounded px-3 py-2 text-sm"
                  style={{ borderColor: "var(--color-primary)" }}
                />
              </div>
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
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={termsAccepted}
                onChange={(e) => setTermsAccepted(e.target.checked)}
                className="rounded mt-1"
                style={{ accentColor: "var(--color-primary)" }}
              />
              <span className="text-sm" style={{ color: "var(--color-text)" }}>
                I understand and agree to the seller&apos;s delivery terms.
              </span>
            </label>
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
