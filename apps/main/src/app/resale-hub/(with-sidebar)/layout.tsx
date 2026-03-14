export default function ResaleHubWithSidebarLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <section className="py-12 px-4" style={{ padding: "var(--section-padding)" }}>
      <div className="max-w-[var(--max-width)] xl:max-w-[1520px] mx-auto">
        {children}
      </div>
    </section>
  );
}
