"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CreatePostButton } from "@/components/CreatePostButton";

const ACTIONS_LINKS = [
  { href: "/my-community/tags", label: "Manage Tags" },
  { href: "/my-community/post-event", label: "Add Event" },
  { href: "/support-nwc", label: "Manage Subscription" },
];

const RESALE_ITEMS = [
  { href: "/resale-hub", label: "Resale Hub" },
  { href: "/my-community/messages", label: "My Messages" },
];

function isActive(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  if (pathname.startsWith(href + "/")) return true;
  return false;
}

export function MyCommunityRightSidebar() {
  const pathname = usePathname();

  return (
    <nav className="border rounded-lg p-4 bg-gray-50 sticky top-24 space-y-6">
      <div>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3 px-1">
          Actions
        </h2>
        <ul className="space-y-1">
          <li>
            <CreatePostButton className="block w-full text-left py-2 px-3 rounded transition font-medium text-gray-800 hover:bg-gray-200">
              Create Post
            </CreatePostButton>
          </li>
          {ACTIONS_LINKS.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                prefetch={false}
                className={`block py-2 px-3 rounded transition font-medium ${
                  isActive(pathname, item.href)
                    ? "text-white"
                    : "text-gray-800 hover:bg-gray-200"
                }`}
                style={
                  isActive(pathname, item.href)
                    ? { backgroundColor: "var(--color-primary)" }
                    : undefined
                }
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
      <div className="pt-3 border-t border-gray-200">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3 px-1">
          Community Resale
        </h2>
        <ul className="space-y-1">
          {RESALE_ITEMS.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                prefetch={false}
                className={`block py-2 px-3 rounded transition font-medium ${
                  isActive(pathname, item.href)
                    ? "text-white"
                    : "text-gray-800 hover:bg-gray-200"
                }`}
                style={
                  isActive(pathname, item.href)
                    ? { backgroundColor: "var(--color-primary)" }
                    : undefined
                }
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
