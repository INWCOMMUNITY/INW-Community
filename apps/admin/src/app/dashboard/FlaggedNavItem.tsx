"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const MAIN_URL = process.env.NEXT_PUBLIC_MAIN_SITE_URL || "http://localhost:3000";
const ADMIN_CODE = process.env.NEXT_PUBLIC_ADMIN_CODE ?? "NWC36481";

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
    fetch(`${MAIN_URL}/api/admin/flagged/count`, {
      headers: { "x-admin-code": ADMIN_CODE },
    })
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
