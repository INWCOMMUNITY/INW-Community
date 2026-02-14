"use client";

/**
 * Catches errors in the root layout. Must define its own html and body.
 * Required for "missing required error components" - Next.js needs this for full error handling.
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
      <body style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", maxWidth: "32rem", margin: "0 auto" }}>
        <h1 style={{ color: "#b91c1c", fontSize: "1.25rem", marginBottom: "0.5rem" }}>
          Something went wrong
        </h1>
        <p style={{ color: "#991b1b", fontSize: "0.875rem", marginBottom: "1rem" }}>
          {error?.message ?? "An unexpected error occurred."}
        </p>
        <button
          type="button"
          onClick={() => reset()}
          style={{
            padding: "0.5rem 1rem",
            backgroundColor: "#dc2626",
            color: "white",
            border: "none",
            borderRadius: "0.25rem",
            cursor: "pointer",
            fontSize: "0.875rem",
          }}
        >
          Try again
        </button>
        <a
          href="/"
          style={{
            display: "inline-block",
            marginLeft: "0.75rem",
            padding: "0.5rem 1rem",
            border: "1px solid #9ca3af",
            borderRadius: "0.25rem",
            color: "#374151",
            textDecoration: "none",
            fontSize: "0.875rem",
          }}
        >
          Go to Home
        </a>
      </body>
    </html>
  );
}
