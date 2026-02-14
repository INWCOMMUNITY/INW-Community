"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useSession } from "next-auth/react";

export default function ScanPage() {
  const params = useParams();
  const { data: session, status } = useSession();
  const businessId = params.businessId as string;
  const [result, setResult] = useState<{
    points?: number;
    businessName?: string;
    error?: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [scanned, setScanned] = useState(false);

  useEffect(() => {
    if (status === "loading" || !session?.user || scanned) return;
    setLoading(true);
    fetch("/api/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ businessId }),
    })
      .then((r) => r.json())
      .then((data) => {
        setResult(data);
        setScanned(true);
      })
      .catch(() => setResult({ error: "Something went wrong" }))
      .finally(() => setLoading(false));
  }, [session?.user, businessId, status, scanned]);

  if (status === "loading") {
    return (
      <section className="py-12 px-4" style={{ padding: "var(--section-padding)" }}>
        <div className="max-w-[var(--max-width)] mx-auto text-center">
          <p className="text-gray-500">Loading…</p>
        </div>
      </section>
    );
  }

  if (!session?.user) {
    return (
      <section className="py-12 px-4" style={{ padding: "var(--section-padding)" }}>
        <div className="max-w-[var(--max-width)] mx-auto text-center">
          <h1 className="text-2xl font-bold mb-4">Sign in to collect your points</h1>
          <p className="text-gray-600 mb-6">
            Scan a business&apos;s QR code to earn Community Points. Sign in or create an account to collect your points.
          </p>
          <div className="flex gap-4 justify-center">
            <Link
              href={`/login?callbackUrl=${encodeURIComponent(`/scan/${businessId}`)}`}
              className="btn"
            >
              Sign in
            </Link>
            <Link
              href={`/signup?callbackUrl=${encodeURIComponent(`/scan/${businessId}`)}`}
              className="btn border border-gray-300 bg-white hover:bg-gray-50"
            >
              Create account
            </Link>
          </div>
        </div>
      </section>
    );
  }

  if (loading) {
    return (
      <section className="py-12 px-4" style={{ padding: "var(--section-padding)" }}>
        <div className="max-w-[var(--max-width)] mx-auto text-center">
          <p className="text-gray-500">Processing scan…</p>
        </div>
      </section>
    );
  }

  if (result?.error && result.points === undefined) {
    return (
      <section className="py-12 px-4" style={{ padding: "var(--section-padding)" }}>
        <div className="max-w-[var(--max-width)] mx-auto text-center">
          <h1 className="text-2xl font-bold mb-4">Oops</h1>
          <p className="text-gray-600 mb-6">{result.error}</p>
          <Link href="/" className="btn">Back to home</Link>
        </div>
      </section>
    );
  }

  const firstName = (session.user as { name?: string }).name?.split(" ")[0] ?? "Member";
  const points = result?.points ?? 0;
  const businessName = result?.businessName ?? "this business";

  return (
    <section className="py-12 px-4" style={{ padding: "var(--section-padding)" }}>
      <div className="max-w-[var(--max-width)] mx-auto text-center">
        <h1 className="text-3xl font-bold mb-4">
          Thanks {firstName} for supporting local!
        </h1>
        {result?.error === "Already scanned today" ? (
          <p className="text-gray-600 mb-6">
            You&apos;ve already scanned {businessName}&apos;s QR code today. Come back tomorrow to earn more points!
          </p>
        ) : (
          <p className="text-xl text-gray-600 mb-6">
            You&apos;ve earned <strong>{points} Community Points</strong> for supporting {businessName}.
          </p>
        )}
        <Link href="/my-community" className="btn">View My Community</Link>
      </div>
    </section>
  );
}
