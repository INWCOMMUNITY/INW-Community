"use client";

import { useEffect, useState } from "react";
import { useLockBodyScroll } from "@/lib/scroll-lock";

interface PointsEarnedModalProps {
  open: boolean;
  onClose: () => void;
  businessName: string;
  pointsAwarded: number;
  previousTotal: number;
  newTotal: number;
  message?: string;
  buttonText?: string;
}

export function PointsEarnedModal({
  open,
  onClose,
  businessName,
  pointsAwarded,
  previousTotal,
  newTotal,
  message,
  buttonText = "Awesome!",
}: PointsEarnedModalProps) {
  const [displayPoints, setDisplayPoints] = useState(previousTotal);

  useLockBodyScroll(open);

  useEffect(() => {
    if (!open) return;
    setDisplayPoints(previousTotal);
    const steps = 30;
    const duration = 1500;
    const increment = (newTotal - previousTotal) / steps;
    let current = previousTotal;
    let step = 0;
    const t = setInterval(() => {
      step++;
      current += increment;
      if (step >= steps) {
        setDisplayPoints(newTotal);
        clearInterval(t);
      } else {
        setDisplayPoints(Math.round(current));
      }
    }, duration / steps);
    return () => clearInterval(t);
  }, [open, previousTotal, newTotal]);

  if (!open) return null;

  const defaultMessage = (
    <>
      You have earned {pointsAwarded} points for supporting <strong>{businessName}</strong>.
      <br />
      Thanks for supporting local businesses!
    </>
  );

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.6)" }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Points earned"
    >
      <div
        className="w-full max-w-sm rounded-2xl shadow-xl p-7 text-center relative"
        style={{
          backgroundColor: "var(--color-background)",
          border: "3px solid var(--color-primary)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3 right-3 p-1 text-gray-500 hover:text-gray-700"
          aria-label="Close"
        >
          <span className="text-xl leading-none">×</span>
        </button>

        <div
          className="w-20 h-20 rounded-full mx-auto mb-4 flex items-center justify-center"
          style={{ backgroundColor: "color-mix(in srgb, var(--color-primary) 20%, transparent)" }}
        >
          <svg
            className="w-12 h-12"
            style={{ color: "var(--color-primary)" }}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17" />
          </svg>
        </div>

        <h2
          className="text-xl font-bold mb-1"
          style={{ fontFamily: "var(--font-heading)", color: "var(--color-heading)" }}
        >
          Points Earned!
        </h2>
        <p className="text-3xl font-extrabold mb-3" style={{ color: "var(--color-primary)" }}>
          +{pointsAwarded}
        </p>
        <p className="text-sm text-gray-600 mb-5 leading-relaxed">
          {message ?? defaultMessage}
        </p>
        <div
          className="rounded-lg py-3 px-5 mb-5 inline-block"
          style={{ backgroundColor: "color-mix(in srgb, var(--color-primary) 15%, transparent)" }}
        >
          <span className="text-sm text-gray-600">Your Total </span>
          <span className="text-2xl font-bold ml-2" style={{ color: "var(--color-primary)" }}>
            {displayPoints} pts
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="w-full py-3.5 rounded-lg font-semibold text-white hover:opacity-90 transition-opacity"
          style={{ backgroundColor: "var(--color-primary)" }}
        >
          {buttonText}
        </button>
      </div>
    </div>
  );
}
