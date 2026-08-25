"use client";

import { useState, useEffect, useCallback } from "react";
import { IonIcon } from "@/components/IonIcon";

interface BusinessProfileInfo {
  id: string;
  name: string;
  shortDescription: string | null;
  fullDescription: string | null;
  logoUrl: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  hoursOfOperation: Record<string, string> | null;
  photos: string[];
  facebookUrl?: string | null;
  instagramUrl?: string | null;
  tiktokUrl?: string | null;
}

interface CompletionItem {
  key: string;
  label: string;
  complete: boolean;
  weight: number;
}

function calculateCompletion(business: BusinessProfileInfo): {
  percentage: number;
  items: CompletionItem[];
} {
  const items: CompletionItem[] = [
    { key: "name", label: "Business name", complete: !!business.name?.trim(), weight: 15 },
    { key: "shortDescription", label: "Brief description", complete: !!business.shortDescription?.trim(), weight: 15 },
    { key: "fullDescription", label: "Full description", complete: !!business.fullDescription?.trim(), weight: 10 },
    { key: "logoUrl", label: "Logo", complete: !!business.logoUrl?.trim(), weight: 15 },
    { key: "address", label: "Address", complete: !!business.address?.trim(), weight: 10 },
    { key: "phone", label: "Phone number", complete: !!business.phone?.trim(), weight: 5 },
    { key: "email", label: "Email", complete: !!business.email?.trim(), weight: 5 },
    { key: "website", label: "Website", complete: !!business.website?.trim(), weight: 5 },
    {
      key: "hoursOfOperation",
      label: "Hours of operation",
      complete:
        !!business.hoursOfOperation &&
        typeof business.hoursOfOperation === "object" &&
        Object.keys(business.hoursOfOperation).length > 0,
      weight: 10,
    },
    { key: "photos", label: "Gallery photos", complete: (business.photos?.length ?? 0) >= 1, weight: 10 },
  ];

  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
  const completedWeight = items.reduce(
    (sum, item) => sum + (item.complete ? item.weight : 0),
    0
  );
  const percentage = Math.round((completedWeight / totalWeight) * 100);

  return { percentage, items };
}

export function useBusinessCompletion(businessId: string | null) {
  const [percentage, setPercentage] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    if (!businessId) {
      setPercentage(null);
      return;
    }
    try {
      const res = await fetch(`/api/businesses/${businessId}`, { credentials: "include" });
      if (!res.ok) {
        setPercentage(null);
        return;
      }
      const data = (await res.json()) as BusinessProfileInfo;
      setPercentage(calculateCompletion(data).percentage);
    } catch {
      setPercentage(null);
    }
  }, [businessId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { percentage, refresh };
}

const PROFILE_COMPLETION_DISMISSED_KEY = "nwc-profile-completion-dismissed";

export function getDismissedProfileCompletionIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(PROFILE_COMPLETION_DISMISSED_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function isProfileCompletionDismissed(businessId: string): boolean {
  return getDismissedProfileCompletionIds().includes(businessId);
}

export function dismissProfileCompletion(businessIds: string[]): void {
  if (typeof window === "undefined" || businessIds.length === 0) return;
  const next = [...new Set([...getDismissedProfileCompletionIds(), ...businessIds])];
  localStorage.setItem(PROFILE_COMPLETION_DISMISSED_KEY, JSON.stringify(next));
}

export function BusinessProfileCompletionCard({
  businessIds,
  onOpenBusinessForm,
}: {
  businessIds: string[];
  onOpenBusinessForm: () => void;
}) {
  const [dismissed, setDismissed] = useState(true);
  const [businesses, setBusinesses] = useState<BusinessProfileInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchBusinesses = useCallback(async () => {
    if (businessIds.length === 0) {
      setLoading(false);
      return;
    }
    try {
      const results = await Promise.all(
        businessIds.map((id) =>
          fetch(`/api/businesses/${id}`, { credentials: "include" })
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null)
        )
      );
      setBusinesses(results.filter(Boolean) as BusinessProfileInfo[]);
    } catch {
      setBusinesses([]);
    } finally {
      setLoading(false);
    }
  }, [businessIds]);

  useEffect(() => {
    fetchBusinesses();
  }, [fetchBusinesses]);

  useEffect(() => {
    if (loading || businesses.length === 0) return;
    const dismissedIds = getDismissedProfileCompletionIds();
    const allDismissed = businesses.every((b) => dismissedIds.includes(b.id));
    setDismissed(allDismissed);
  }, [businesses, loading]);

  if (loading || dismissed || businesses.length === 0) return null;

  const handleDismiss = () => {
    dismissProfileCompletion(businesses.map((b) => b.id));
    setDismissed(true);
  };

  const firstIncomplete = businesses.find((b) => {
    const { percentage } = calculateCompletion(b);
    return percentage < 100;
  });

  if (!firstIncomplete) return null;

  const { percentage, items } = calculateCompletion(firstIncomplete);
  const missingItems = items.filter((item) => !item.complete);

  if (percentage === 100) return null;

  return (
    <div
      className="relative mb-4 rounded-xl border p-3 md:p-4"
      style={{
        borderColor: "var(--color-earth)",
        backgroundColor: "var(--color-section-alt)",
      }}
    >
      <button
        type="button"
        onClick={handleDismiss}
        className="absolute top-2 right-2 w-7 h-7 flex items-center justify-center rounded-full hover:bg-black/10 transition-colors"
        aria-label="Dismiss profile completion card"
      >
        <IonIcon name="close" size={18} className="text-gray-500" />
      </button>

      <div className="flex items-start gap-3">
        <div
          className="shrink-0 w-11 h-11 rounded-full flex items-center justify-center"
          style={{ backgroundColor: "var(--color-primary)" }}
        >
          <span className="text-white font-bold text-sm">{percentage}%</span>
        </div>
        <div className="flex-1 min-w-0 pr-6">
          <h3
            className="text-sm font-semibold mb-0.5"
            style={{ color: "var(--color-heading)" }}
          >
            Complete your business profile
          </h3>
          <p className="text-sm text-gray-600 mb-2">
            A complete profile helps customers find and trust your business.
          </p>
          {missingItems.length > 0 && (
            <div className="mb-3">
              <p className="text-xs text-gray-500 mb-2">Missing:</p>
              <div className="flex flex-wrap gap-1.5">
                {missingItems.slice(0, 4).map((item) => (
                  <span
                    key={item.key}
                    className="text-xs px-2 py-0.5 rounded-full border"
                    style={{
                      borderColor: "var(--color-primary)",
                      color: "var(--color-primary)",
                    }}
                  >
                    {item.label}
                  </span>
                ))}
                {missingItems.length > 4 && (
                  <span className="text-xs text-gray-500">
                    +{missingItems.length - 4} more
                  </span>
                )}
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={onOpenBusinessForm}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white transition-opacity hover:opacity-90"
            style={{ backgroundColor: "var(--color-primary)" }}
          >
            <IonIcon name="create-outline" size={16} className="text-white" />
            Edit Business Profile
          </button>
        </div>
      </div>

      <div className="mt-3">
        <div
          className="h-2 rounded-full overflow-hidden"
          style={{ backgroundColor: "#e5e7eb" }}
        >
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{
              width: `${percentage}%`,
              backgroundColor: "var(--color-primary)",
            }}
          />
        </div>
      </div>
    </div>
  );
}
