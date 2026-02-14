"use client";

import { createContext, useContext, useState, useEffect, useCallback } from "react";
import type { Session } from "next-auth";

interface CartContextValue {
  count: number;
  refresh: () => void;
  open: boolean;
  setOpen: (open: boolean) => void;
}

const CartContext = createContext<CartContextValue>({
  count: 0,
  refresh: () => {},
  open: false,
  setOpen: () => {},
});

function CartProviderInner({ children, session }: { children: React.ReactNode; session?: Session | null }) {
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const status = session ? "authenticated" : "unauthenticated";

  const refresh = useCallback(() => {
    if (status !== "authenticated") {
      setCount(0);
      return;
    }
    fetch("/api/cart")
      .then((r) => r.json())
      .then((items) => {
        if (Array.isArray(items)) {
          setCount(items.reduce((sum, i) => sum + (i.quantity ?? 1), 0));
        } else {
          setCount(0);
        }
      })
      .catch(() => setCount(0));
  }, [status]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <CartContext.Provider value={{ count, refresh, open, setOpen }}>
      {children}
    </CartContext.Provider>
  );
}

export function CartProvider({ children, session }: { children: React.ReactNode; session?: Session | null }) {
  return <CartProviderInner session={session}>{children}</CartProviderInner>;
}

export function useCart() {
  return useContext(CartContext);
}
