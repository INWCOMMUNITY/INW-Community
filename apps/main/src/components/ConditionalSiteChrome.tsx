"use client";

import { usePathname } from "next/navigation";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";

function useHideInResaleHub() {
  const pathname = usePathname();
  return pathname?.startsWith("/resale-hub") ?? false;
}

/** Renders Header only when not in Resale Hub (main menu disappears in Resale Hub). */
export function ConditionalHeader() {
  if (useHideInResaleHub()) return null;
  return <Header />;
}

/** Renders Footer only when not in Resale Hub. */
export function ConditionalFooter() {
  if (useHideInResaleHub()) return null;
  return <Footer />;
}
