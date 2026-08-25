import { ClientErrorBoundary } from "@/components/ClientErrorBoundary";

export default function SellerOrdersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Auth is enforced by `seller-hub/layout.tsx`. Do not query Prisma here:
  // a hung DB call in this nested layout produces a blank page with no error log.
  return (
    <div className="py-8" style={{ padding: "var(--section-padding)" }}>
      <main className="max-w-[var(--max-width)] xl:max-w-[1520px] mx-auto">
        <ClientErrorBoundary>{children}</ClientErrorBoundary>
      </main>
    </div>
  );
}
