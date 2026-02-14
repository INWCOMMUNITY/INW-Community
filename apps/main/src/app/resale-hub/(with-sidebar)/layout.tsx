"use client";

import { ResaleHubSidebar } from "@/components/ResaleHubSidebar";

export default function ResaleHubWithSidebarLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      className="resale-hub-layout flex flex-col md:flex-row gap-8 max-md:gap-0 py-8"
      style={{ padding: "var(--section-padding)" }}
    >
      <aside className="hidden md:block shrink-0 no-print">
        <ResaleHubSidebar />
      </aside>
      <main className="flex-1 min-w-0 w-full md:w-auto">{children}</main>
      <div className="md:hidden shrink-0 w-0 overflow-visible">
        <ResaleHubSidebar mobile />
      </div>
    </div>
  );
}
