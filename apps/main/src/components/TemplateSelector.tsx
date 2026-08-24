"use client";

import { useState, useEffect, useCallback } from "react";

export interface ListingTemplate {
  id: string;
  name: string;
  category?: string | null;
  subcategory?: string | null;
  condition?: string | null;
  shippingDisabled?: boolean;
  localDeliveryAvailable?: boolean;
  inStorePickupAvailable?: boolean;
  shippingCostCents?: number | null;
  shippingOptionId?: string | null;
  localDeliveryFeeCents?: number | null;
  shippingPolicy?: string | null;
  localDeliveryTerms?: string | null;
  pickupTerms?: string | null;
  etsyWhoMade?: string | null;
  etsyWhenMade?: string | null;
  etsyIsSupply?: boolean | null;
  ebayCategoryId?: number | null;
  ebayAspects?: { name: string; value: string }[] | null;
  variantsTemplate?: { axes?: { name: string; options: string[] }[] } | null;
  createdAt?: string;
  updatedAt?: string;
}

interface TemplateSelectorProps {
  onSelectTemplate: (template: ListingTemplate) => void;
  disabled?: boolean;
}

export function TemplateSelector({ onSelectTemplate, disabled }: TemplateSelectorProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [templates, setTemplates] = useState<ListingTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/listing-templates");
      if (!res.ok) throw new Error("Failed to fetch templates");
      const data = await res.json();
      setTemplates(data.templates || []);
    } catch {
      setError("Failed to load templates");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (modalOpen) {
      fetchTemplates();
    }
  }, [modalOpen, fetchTemplates]);

  const handleSelect = (template: ListingTemplate) => {
    setModalOpen(false);
    onSelectTemplate(template);
  };

  const handleDelete = async (templateId: string) => {
    if (!confirm("Delete this template?")) return;
    try {
      await fetch(`/api/listing-templates/${templateId}`, { method: "DELETE" });
      setTemplates((prev) => prev.filter((t) => t.id !== templateId));
    } catch {
      alert("Failed to delete template");
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setModalOpen(true)}
        disabled={disabled}
        className="inline-flex items-center px-4 py-2 border border-primary text-primary rounded-lg hover:bg-primary/5 transition-colors disabled:opacity-50"
      >
        Start from Template
      </button>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl w-full max-w-md max-h-[80vh] flex flex-col shadow-xl">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <h2 className="text-lg font-semibold">Listing Templates</h2>
              <button
                onClick={() => setModalOpen(false)}
                className="text-gray-500 hover:text-gray-700 text-xl leading-none"
              >
                ×
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin rounded-full h-6 w-6 border-2 border-primary border-t-transparent" />
                  <span className="ml-2 text-gray-600">Loading...</span>
                </div>
              ) : error ? (
                <div className="text-center py-8">
                  <p className="text-red-600 mb-3">{error}</p>
                  <button
                    onClick={fetchTemplates}
                    className="text-primary hover:underline"
                  >
                    Retry
                  </button>
                </div>
              ) : templates.length === 0 ? (
                <div className="text-center py-8">
                  <p className="font-medium text-gray-700 mb-2">No templates yet</p>
                  <p className="text-sm text-gray-500">
                    Save a listing as a template to reuse its settings.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {templates.map((template) => (
                    <div
                      key={template.id}
                      className="border rounded-lg p-3 hover:bg-gray-50 flex items-start justify-between gap-2"
                    >
                      <button
                        type="button"
                        onClick={() => handleSelect(template)}
                        className="flex-1 text-left"
                      >
                        <p className="font-medium">{template.name}</p>
                        <div className="text-sm text-gray-600 mt-1 space-y-0.5">
                          {template.category && (
                            <p>
                              Category: {template.category}
                              {template.subcategory ? ` / ${template.subcategory}` : ""}
                            </p>
                          )}
                          {template.condition && (
                            <p>Condition: {template.condition === "new" ? "New" : "Used"}</p>
                          )}
                          {template.etsyWhoMade && <p>Etsy fields included</p>}
                          {template.ebayCategoryId && <p>eBay category included</p>}
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(template.id)}
                        className="text-red-600 hover:text-red-700 text-sm shrink-0"
                      >
                        Delete
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

interface SaveTemplateButtonProps {
  storeItemId: string;
  onSaved?: () => void;
}

export function SaveTemplateButton({ storeItemId, onSaved }: SaveTemplateButtonProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!templateName.trim()) {
      setError("Template name is required");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const res = await fetch(`/api/listing-templates/from-item/${storeItemId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: templateName.trim() }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save template");
      }
      setModalOpen(false);
      setTemplateName("");
      alert("Template saved successfully!");
      onSaved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save template");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setModalOpen(true)}
        className="text-sm text-gray-600 hover:text-primary underline"
      >
        Save as Template
      </button>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl w-full max-w-sm p-6 shadow-xl">
            <h2 className="text-lg font-semibold mb-2">Save as Template</h2>
            <p className="text-sm text-gray-600 mb-4">
              Save this listing&apos;s settings to quickly create similar items.
            </p>

            <input
              type="text"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              placeholder="Template name"
              maxLength={100}
              className="w-full border rounded-lg px-3 py-2 mb-3"
            />

            {error && <p className="text-red-600 text-sm mb-3">{error}</p>}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setModalOpen(false);
                  setTemplateName("");
                  setError(null);
                }}
                className="flex-1 px-4 py-2 border rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="flex-1 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
