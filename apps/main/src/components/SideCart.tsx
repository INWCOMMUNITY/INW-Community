"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useLockBodyScroll } from "@/lib/scroll-lock";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useCart } from "@/contexts/CartContext";

interface CartItem {
  id: string;
  storeItemId: string;
  quantity: number;
  variant: unknown;
  storeItem: {
    id: string;
    title: string;
    slug: string;
    photos: string[];
    priceCents: number;
    quantity: number;
    status: string;
    variants: unknown;
  };
}

export function SideCart() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const { open, setOpen, refresh } = useCart();
  const [items, setItems] = useState<CartItem[]>([]);
  const [loading, setLoading] = useState(false);

  useLockBodyScroll(open);

  useEffect(() => {
    if (open && status === "authenticated") {
      setLoading(true);
      fetch("/api/cart")
        .then((r) => r.json())
        .then((d) => {
          setItems(Array.isArray(d) ? d : []);
          refresh();
        })
        .catch(() => setItems([]))
        .finally(() => setLoading(false));
    }
  }, [open, status]);

  async function removeItem(itemId: string) {
    const res = await fetch(`/api/cart/${itemId}`, { method: "DELETE" });
    if (res.ok) {
      setItems((prev) => prev.filter((i) => i.id !== itemId));
      refresh();
    }
  }

  async function updateQuantity(itemId: string, quantity: number) {
    const res = await fetch(`/api/cart/${itemId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quantity }),
    });
    if (res.ok) {
      setItems((prev) =>
        prev.map((i) => (i.id === itemId ? { ...i, quantity } : i))
      );
      refresh();
    }
  }

  function handleCheckout() {
    if (items.length === 0) return;
    setOpen(false);
    router.push("/cart");
  }

  if (!open) return null;

  const subtotalCents = items.reduce(
    (sum, i) => sum + i.storeItem.priceCents * i.quantity,
    0
  );
  const itemCount = items.reduce((sum, i) => sum + (i.quantity ?? 1), 0);

  return (
    <>
      <div
        className="fixed inset-0 bg-black/40 z-[100] overflow-hidden"
        onClick={() => setOpen(false)}
        aria-hidden="true"
      />
      <aside
        className="fixed top-0 right-0 h-full w-full max-w-md bg-white shadow-xl z-[100] flex flex-col"
        role="dialog"
        aria-label="Shopping cart"
      >
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-bold">
            My Local Shopping Cart ({itemCount} {itemCount === 1 ? "item" : "items"})
          </h2>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="p-2 hover:bg-gray-100 rounded"
            aria-label="Close cart"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {status === "unauthenticated" ? (
            <p className="text-gray-600 py-4">Sign in to view your cart.</p>
          ) : loading ? (
            <p className="text-gray-500 py-4">Loading…</p>
          ) : items.length === 0 ? (
            <p className="text-gray-600 py-4">Your cart is empty.</p>
          ) : (
            <ul className="space-y-3">
              {items.map((item) => (
                <li
                  key={item.id}
                  className="flex gap-3 border-b pb-3 last:border-b-0"
                >
                  {item.storeItem.photos[0] ? (
                    <img
                      src={item.storeItem.photos[0]}
                      alt=""
                      className="w-16 h-16 object-cover rounded shrink-0"
                    />
                  ) : (
                    <div className="w-16 h-16 bg-gray-100 rounded shrink-0 flex items-center justify-center text-gray-400 text-xs">
                      No image
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <Link
                      href={`/storefront/${item.storeItem.slug}`}
                      className="font-medium hover:underline text-sm"
                      onClick={() => setOpen(false)}
                    >
                      {item.storeItem.title}
                    </Link>
                    {item.variant && typeof item.variant === "object" && Object.keys(item.variant as object).length > 0 ? (
                      <p className="text-xs text-gray-500 mt-0.5">
                        {Object.entries(item.variant as Record<string, string>)
                          .map(([k, v]) => `${k}: ${v}`)
                          .join(", ")}
                      </p>
                    ) : null}
                    <p className="text-sm font-bold mt-1">
                      ${(item.storeItem.priceCents / 100).toFixed(2)}
                    </p>
                    <div className="flex items-center gap-2 mt-2">
                      <button
                        type="button"
                        onClick={() =>
                          updateQuantity(item.id, Math.max(1, item.quantity - 1))
                        }
                        className="w-6 h-6 border rounded text-sm leading-none"
                      >
                        −
                      </button>
                      <span className="text-sm w-6 text-center">{item.quantity}</span>
                      <button
                        type="button"
                        onClick={() =>
                          updateQuantity(
                            item.id,
                            Math.min(item.storeItem.quantity, item.quantity + 1)
                          )
                        }
                        className="w-6 h-6 border rounded text-sm leading-none"
                      >
                        +
                      </button>
                      <button
                        type="button"
                        onClick={() => removeItem(item.id)}
                        className="text-red-600 text-xs hover:underline ml-2"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="border-t p-4 space-y-3">
          <p className="text-xs text-gray-500">
            <Link href="/cart" className="hover:underline" onClick={() => setOpen(false)}>
              Enter a promo code
            </Link>
            {" · "}
            <Link href="/cart" className="hover:underline" onClick={() => setOpen(false)}>
              Add a note
            </Link>
          </p>
          <p className="font-bold">
            Estimated total: ${(subtotalCents / 100).toFixed(2)}
          </p>
          <p className="text-xs text-gray-500">
            Taxes and shipping calculated at checkout.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleCheckout}
              disabled={items.length === 0}
              className="btn flex-1 disabled:opacity-50"
            >
              Checkout
            </button>
            <Link
              href="/cart"
              onClick={() => setOpen(false)}
              className="btn border border-gray-300 bg-white hover:bg-gray-50 inline-block"
            >
              View Cart
            </Link>
          </div>
          <p className="text-xs text-gray-500 flex items-center gap-1">
            <span aria-hidden>🔒</span> Secure Checkout
          </p>
        </div>
      </aside>
    </>
  );
}
