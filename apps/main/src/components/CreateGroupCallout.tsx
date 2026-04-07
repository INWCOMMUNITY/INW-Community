import Link from "next/link";

/**
 * Framed CTA for starting a new community group — used on listing pages so the action isn’t a lone floating button.
 */
export function CreateGroupCallout({ className = "" }: { className?: string }) {
  return (
    <aside
      className={`rounded-xl border-2 p-6 sm:p-8 text-center shadow-sm ${className}`.trim()}
      style={{
        borderColor: "var(--color-primary)",
        backgroundColor: "var(--color-background)",
        boxShadow: "0 1px 3px rgba(62, 67, 47, 0.08)",
      }}
    >
      <h2
        className="text-lg sm:text-xl font-bold mb-3"
        style={{ fontFamily: "var(--font-heading)", color: "var(--color-heading)" }}
      >
        Become a Group Admin
      </h2>
      <p
        className="text-sm sm:text-base mb-6 max-w-lg mx-auto leading-relaxed"
        style={{ color: "var(--color-text)" }}
      >
        Submit a request to start a group. Requests are reviewed; if yours is not approved, you will get an email with a
        brief explanation.
      </p>
      <Link href="/community-groups/new" className="btn inline-block">
        Request a group
      </Link>
    </aside>
  );
}
