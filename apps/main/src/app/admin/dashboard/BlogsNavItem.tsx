"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { IonIcon } from "@/components/IonIcon";

export function BlogsNavItem({
  href,
  label,
  icon = "newspaper-outline",
  isActive,
  onClick,
}: {
  href: string;
  label: string;
  icon?: string;
  isActive: boolean;
  onClick: () => void;
}) {
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    fetch("/api/admin/blogs/pending-count")
      .then((r) => r.json())
      .then((data) => setPendingCount(data?.count ?? 0))
      .catch(() => {});
  }, []);

  return (
    <Link
      href={href}
      onClick={onClick}
      className={`flex items-center gap-2.5 px-4 py-2 text-sm font-medium rounded-r ${
        isActive ? "border-l-4" : "hover:bg-[#FDEDCC]/30"
      }`}
      style={isActive ? { backgroundColor: "#FDEDCC", color: "#3E432F", borderColor: "#505542" } : { color: "#505542" }}
    >
      <IonIcon name={icon} size={20} className="opacity-90 shrink-0" />
      <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
        <span className="truncate">{label}</span>
        {pendingCount > 0 && (
          <span className="bg-amber-500 text-white text-xs font-bold rounded-full min-w-[1.25rem] h-5 px-1.5 flex shrink-0 items-center justify-center">
            {pendingCount > 99 ? "99+" : pendingCount}
          </span>
        )}
      </span>
    </Link>
  );
}
