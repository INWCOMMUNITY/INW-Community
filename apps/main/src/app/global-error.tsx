"use client";

/**
 * Catches errors in the root layout. Must define its own html and body.
 * Required for "missing required error components" - Next.js needs this for full error handling.
 * Uses site theme colors (#505542 primary, #FDEDCC section-alt).
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <head>
        <title>Something went wrong – Northwest Community</title>
      </head>
      <body style={{ fontFamily: "Helvetica Neue, Helvetica, Arial, sans-serif", padding: "2rem", maxWidth: "32rem", margin: "0 auto", color: "#505542", backgroundColor: "#fff" }}>
        <h1 style={{ color: "#3E432F", fontSize: "1.5rem", marginBottom: "0.5rem", fontWeight: 600 }}>
          Northwest Community
        </h1>
        <h2 style={{ color: "#505542", fontSize: "1.125rem", marginBottom: "0.5rem", fontWeight: 500 }}>
          Something went wrong
        </h2>
        <p style={{ color: "#505542", fontSize: "0.875rem", marginBottom: "1.5rem", opacity: 0.9 }}>
          {error?.message ?? "An unexpected error occurred."}
        </p>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              padding: "0.75rem 1.5rem",
              backgroundColor: "#505542",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "0.875rem",
              fontWeight: 500,
            }}
          >
            Try again
          </button>
          <a
            href="/"
            style={{
              display: "inline-block",
              padding: "0.75rem 1.5rem",
              border: "1px solid #e5e3df",
              borderRadius: "4px",
              color: "#505542",
              textDecoration: "none",
              fontSize: "0.875rem",
              backgroundColor: "#FDEDCC",
            }}
          >
            Go to Home
          </a>
        </div>
      </body>
    </html>
  );
}
