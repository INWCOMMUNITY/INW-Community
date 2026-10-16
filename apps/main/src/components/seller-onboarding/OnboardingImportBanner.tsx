"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

export function OnboardingImportBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    setShow(new URLSearchParams(window.location.search).get("onboarding") === "1");
  }, []);

  if (!show) return null;

  return (
    <div
      className="mb-4 rounded-lg border px-4 py-3 text-sm"
      style={{ backgroundColor: "#FDEDCC", borderColor: "#5d4f40" }}
    >
      When you are finished here,{" "}
      <Link href="/signup/seller?step=import" className="font-medium underline">
        continue onboarding
      </Link>
      .
    </div>
  );
}
