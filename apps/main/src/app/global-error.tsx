"use client";

/**
 * Catches unhandled errors in the root layout so they don't surface as raw
 * "Uncaught Exception" in logs. Must define its own <html>/<body>.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  if (typeof window !== "undefined") {
    console.error("Global error:", error);
  }

  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", padding: "2rem", background: "#fef2f2", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ maxWidth: "28rem", padding: "1.5rem", background: "#fff", borderRadius: "8px", border: "1px solid #fecaca", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }}>
          <h1 style={{ margin: "0 0 0.5rem", fontSize: "1.25rem", color: "#b91c1c" }}>
            Something went wrong
          </h1>
          <p style={{ margin: "0 0 1rem", fontSize: "0.875rem", color: "#374151", wordBreak: "break-word" }}>
            {error?.message ?? "An unexpected error occurred."}
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{ padding: "0.5rem 1rem", fontSize: "0.875rem", fontWeight: 500, color: "#fff", background: "#b91c1c", border: "none", borderRadius: "6px", cursor: "pointer" }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
