"use client";

import { useState } from "react";
import { getBadgeIcon, getBadgeCategoryLabel } from "@/lib/badge-icons";

interface Badge {
  id: string;
  slug: string;
  name: string;
  description: string;
  imageUrl: string | null;
  category: string;
  order: number;
}

export function BadgeCard({ badge }: { badge: Badge }) {
  const [expanded, setExpanded] = useState(false);
  const desc = badge.description ?? "";
  const needsExpand = desc.length > 80;
  const Icon = getBadgeIcon(badge.slug);

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
          <Icon className="w-7 h-7" style={{ width: 28, height: 28 }} />
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
        </div>
      </div>
    </div>
  );
}
