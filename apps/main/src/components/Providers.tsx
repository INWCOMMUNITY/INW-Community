"use client";

import { SessionProvider } from "next-auth/react";
import { CartProvider } from "@/contexts/CartContext";
import { TagsProvider } from "@/contexts/TagsContext";
import { SideCart } from "@/components/SideCart";
import { TagsSidebar } from "@/components/TagsSidebar";
import type { Session } from "next-auth";

export function Providers({ children, session }: { children: React.ReactNode; session?: Session | null }) {
  return (
    <SessionProvider session={session} refetchInterval={0} refetchOnWindowFocus={false}>
      <CartProvider session={session}>
        <TagsProvider>
          {children}
          <SideCart />
          <TagsSidebar />
        </TagsProvider>
      </CartProvider>
    </SessionProvider>
  );
}
