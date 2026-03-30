"use client";

import { useState } from "react";
import { BadgeIcon, getBadgeCategoryLabel } from "@/lib/badge-icons";
import { BADGE_SCAN_PROGRESS_TAN } from "@/lib/badge-scan-progress-ui";

interface Badge {
  id: string;
  slug: string;
  name: string;
  description: string;
  imageUrl: string | null;
  category: string;
  order: number;
}

export function BadgeCard({
  badge,
  scanProgress,
}: {
  badge: Badge;
  /** When set, shows a tan progress bar (scan / category-scan badges). */
  scanProgress?: { current: number; target: number } | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const desc = badge.description ?? "";
  const needsExpand = desc.length > 80;

  return (
    <div
      className="border-2 rounded-lg p-4 bg-gray-50 hover:bg-gray-100 transition-colors"
      style={{ borderColor: "var(--color-primary)" }}
    >
      <div className="flex flex-col items-center gap-3 text-center">
        <div
          className="w-12 h-12 rounded-full flex items-center justify-center shrink-0"
          style={{ backgroundColor: "#FDEDCC", color: "var(--color-primary)" }}
        >
          <BadgeIcon slug={badge.slug} size={28} />
        </div>
        <div className="min-w-0 w-full">
          <h2 className="font-semibold text-lg" style={{ color: "var(--color-heading)" }}>
            {badge.name}
          </h2>
          <span className="text-xs text-gray-500">
            {getBadgeCategoryLabel(badge.category)}
          </span>
          <p
            className={`text-gray-600 mt-2 text-sm leading-relaxed ${!expanded && needsExpand ? "line-clamp-2" : ""}`}
          >
            {desc}
          </p>
          {needsExpand && (
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              className="mt-2 text-sm font-medium"
              style={{ color: "var(--color-primary)" }}
            >
              {expanded ? "Show less" : "Read more"}
            </button>
          )}
          {scanProgress && scanProgress.target > 0 && (
            <div className="w-full mt-3 text-left">
              <div
                className="flex justify-between text-xs font-medium mb-1"
                style={{ color: BADGE_SCAN_PROGRESS_TAN.label }}
              >
                <span>Scan progress</span>
                <span>
                  {Math.min(scanProgress.current, scanProgress.target)}/{scanProgress.target}
                </span>
              </div>
              <div
                className="h-2.5 w-full rounded-full overflow-hidden"
                style={{ backgroundColor: BADGE_SCAN_PROGRESS_TAN.track }}
              >
                <div
                  className="h-full rounded-full transition-[width] duration-300 ease-out"
                  style={{
                    width: `${Math.min(100, (scanProgress.current / scanProgress.target) * 100)}%`,
                    backgroundColor: BADGE_SCAN_PROGRESS_TAN.fill,
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
