"use client";

export const UGC_TERMS_STORAGE_KEY = "nwc_community_ugc_terms_v2";

export function hasAcceptedUgcTerms(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(UGC_TERMS_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function acceptUgcTerms(): void {
  try {
    localStorage.setItem(UGC_TERMS_STORAGE_KEY, "1");
  } catch {
    /* ignore */
  }
}
