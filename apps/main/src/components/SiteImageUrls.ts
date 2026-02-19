"use client";

import { useEffect, useState } from "react";

let cache: Record<string, string> | null = null;
let cachePromise: Promise<Record<string, string>> | null = null;

function fetchSiteImages(): Promise<Record<string, string>> {
  return fetch("/api/site-images", { cache: "no-store" })
    .then((r) => r.json())
    .then((data) => (data as Record<string, string>) ?? {})
    .catch(() => ({}));
}

/** Invalidate the site images cache. Call after admin replaces an image so the site updates. */
export function invalidateSiteImageUrls(): void {
  cache = null;
  cachePromise = null;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("site-images-updated"));
    try {
      localStorage.setItem("site-images-updated", Date.now().toString());
    } catch {
      /* ignore */
    }
  }
}

export function useSiteImageUrls(): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>(() => cache ?? {});

  useEffect(() => {
    function load() {
      cachePromise = fetchSiteImages().then((data) => {
        cache = data;
        return data;
      });
      cachePromise.then(setUrls);
    }

    if (cache) {
      setUrls(cache);
    } else if (!cachePromise) {
      load();
    } else {
      cachePromise.then(setUrls);
    }

    const onUpdate = () => {
      cache = null;
      cachePromise = null;
      load();
    };

    const onStorage = (e: StorageEvent) => {
      if (e.key === "site-images-updated") onUpdate();
    };

    window.addEventListener("site-images-updated", onUpdate);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("site-images-updated", onUpdate);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return urls;
}
