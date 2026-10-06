"use client";

import type { ReactNode } from "react";

type ListingEditorLayoutProps = {
  children: ReactNode;
  footer?: ReactNode;
};

export function ListingEditorLayout({ children, footer }: ListingEditorLayoutProps) {
  return (
    <div
      className="w-full max-w-3xl mx-auto pb-28 px-4 sm:px-6 py-6 rounded-2xl"
      style={{ backgroundColor: "var(--color-tan-light, #f7f3ee)" }}
    >
      <div className="space-y-5">{children}</div>
      {footer}
    </div>
  );
}
