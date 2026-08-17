"use client";

import type { ReactNode } from "react";

type ListingEditorLayoutProps = {
  sidebar: ReactNode;
  main: ReactNode;
  footer?: ReactNode;
};

export function ListingEditorLayout({ sidebar, main, footer }: ListingEditorLayoutProps) {
  return (
    <div className="w-full max-w-5xl mx-auto pb-28">
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(280px,360px)_1fr] gap-6 lg:gap-8 items-start">
        <aside className="space-y-5 lg:sticky lg:top-24">{sidebar}</aside>
        <div className="space-y-5 min-w-0">{main}</div>
      </div>
      {footer}
    </div>
  );
}
