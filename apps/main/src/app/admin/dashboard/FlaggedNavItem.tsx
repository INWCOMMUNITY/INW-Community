"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

export function FlaggedNavItem({
  href,
  label,
  isActive,
  onClick,
}: {
  href: string;
  label: string;
  isActive: boolean;
  onClick: () => void;
}) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    fetch("/api/admin/flagged/count")
      .then((r) => r.json())
      .then((data) => setCount(data?.count ?? 0))
      .catch(() => {});
  }, []);

  return (
    <Link
      href={href}
      onClick={onClick}
      className={`block px-4 py-2 text-sm font-medium rounded-r ${
        isActive ? "border-l-4" : "hover:bg-[#FDEDCC]/30"
      }`}
      style={isActive ? { backgroundColor: "#FDEDCC", color: "#3E432F", borderColor: "#505542" } : { color: "#505542" }}
    >
      <span className="flex items-center justify-between gap-2">
        {label}
        {count > 0 && (
          <span className="bg-amber-500 text-white text-xs font-bold rounded-full min-w-[1.25rem] h-5 px-1.5 flex items-center justify-center">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </span>
    </Link>
  );
}
