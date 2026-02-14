"use client";

import { useState, useEffect, useRef } from "react";
import { getErrorMessage } from "@/lib/api-error";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { HeartSaveButton } from "@/components/HeartSaveButton";
import { ShareButton } from "@/components/ShareButton";
import { useCart } from "@/contexts/CartContext";
import { LocalDeliveryModal, type LocalDeliveryDetails } from "@/components/LocalDeliveryModal";
import { PickupTermsModal, type PickupDetails } from "@/components/PickupTermsModal";

interface VariantOption {
  name: string;
  options: string[];
}

type FulfillmentType = "ship" | "local_delivery" | "pickup";

interface StoreItem {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  photos: string[];
  category: string | null;
  priceCents: number;
  quantity: number;
  variants?: VariantOption[] | null;
  shippingCostCents: number | null;
  shippingPolicy: string | null;
  localDeliveryAvailable: boolean;
  localDeliveryFeeCents?: number | null;
  inStorePickupAvailable?: boolean;
  shippingDisabled?: boolean;
  localDeliveryTerms?: string | null;
  acceptOffers?: boolean;
  minOfferCents?: number | null;
  memberId?: string;
  member?: {
    id: string;
    firstName: string;
    lastName: string;
    sellerShippingPolicy?: string | null;
    sellerLocalDeliveryPolicy?: string | null;
    sellerPickupPolicy?: string | null;
    sellerReturnPolicy?: string | null;
    acceptCashForPickupDelivery?: boolean | null;
  };
  business?: {
    id: string;
    name: string;
    slug: string;
    phone?: string | null;
    email?: string | null;
    website?: string | null;
    address?: string | null;
    logoUrl?: string | null;
    fullDescription?: string | null;
  };
}

const RESALE_BASE = "/resale";
const RESALE_STORAGE_KEY = "resaleFilters";

export default function ResaleProductDetailPage() {
  const params = useParams();
  const { data: session, status } = useSession();
  const slug = params.slug as string;
  const [item, setItem] = useState<StoreItem | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [selectedVariant, setSelectedVariant] = useState<Record<string, string>>({});
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [checkingOut, setCheckingOut] = useState(false);
  const [error, setError] = useState("");
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [addingToCart, setAddingToCart] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxZoom, setLightboxZoom] = useState(1);
  const [lightboxPan, setLightboxPan] = useState({ x: 0, y: 0 });
  const [lightboxDragging, setLightboxDragging] = useState(false);
  const lightboxDragStart = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const [sellerItems, setSellerItems] = useState<StoreItem[]>([]);
  const [similarItems, setSimilarItems] = useState<StoreItem[]>([]);
  const [sellerScrollIndex, setSellerScrollIndex] = useState(0);
  const [moreLikeThisScrollIndex, setMoreLikeThisScrollIndex] = useState(0);
  const [keepShoppingHref, setKeepShoppingHref] = useState(RESALE_BASE);
  const ITEMS_PER_SCROLL = 2;
  const { refresh, setOpen: setCartOpen } = useCart();

  const [fulfillmentType, setFulfillmentType] = useState<FulfillmentType>("ship");
  const [localDeliveryModalOpen, setLocalDeliveryModalOpen] = useState(false);
  const [localDeliveryForm, setLocalDeliveryForm] = useState<Partial<LocalDeliveryDetails>>({
    firstName: "",
    lastName: "",
    phone: "",
    deliveryAddress: { street: "", city: "", state: "", zip: "" },
    note: "",
  });
  const [localDeliveryDetailsSaved, setLocalDeliveryDetailsSaved] = useState(false);
  const [pickupModalOpen, setPickupModalOpen] = useState(false);
  const [pickupForm, setPickupForm] = useState<Partial<PickupDetails>>({
    firstName: "",
    lastName: "",
    phone: "",
    email: "",
    preferredPickupTime: "",
    note: "",
  });
  const [pickupDetailsSaved, setPickupDetailsSaved] = useState(false);
  const [makeOfferOpen, setMakeOfferOpen] = useState(false);
  const [offerAmountDollars, setOfferAmountDollars] = useState("");
  const [offerMessage, setOfferMessage] = useState("");
  const [offerSubmitting, setOfferSubmitting] = useState(false);
  const [offerError, setOfferError] = useState("");
  const [messageSellerOpen, setMessageSellerOpen] = useState(false);
  const [messageContent, setMessageContent] = useState("");
  const [messageSubmitting, setMessageSubmitting] = useState(false);
  const [messageError, setMessageError] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"card" | "cash">("card");

  useEffect(() => {
    try {
      const raw = typeof window !== "undefined" ? sessionStorage.getItem(RESALE_STORAGE_KEY) : null;
      const f = raw ? (JSON.parse(raw) as { category?: string; size?: string; search?: string; deliveryFilter?: string }) : {};
      const q = new URLSearchParams();
      if (f.category) q.set("category", f.category);
      if (f.size) q.set("size", f.size);
      if (f.search) q.set("search", f.search);
      if (f.deliveryFilter === "local") q.set("localDelivery", "1");
      if (f.deliveryFilter === "shipping") q.set("shippingOnly", "1");
      const query = q.toString();
      setKeepShoppingHref(query ? `${RESALE_BASE}?${query}` : RESALE_BASE);
    } catch {
      setKeepShoppingHref(RESALE_BASE);
    }
  }, []);

  useEffect(() => {
    if (!slug) return;
    setLoading(true);
    setSelectedPhotoIndex(0);
    setSelectedVariant({});
    setError("");
    const currentSlug = slug;
    fetch(`/api/store-items?slug=${encodeURIComponent(slug)}&listingType=resale`)
      .then((r) => {
        if (!r.ok) {
          return { _notOk: true };
        }
        return r.json();
      })
      .then((data) => {
        if (data && (data as { _notOk?: boolean })._notOk) {
          setItem(null);
          return;
        }
        if (currentSlug !== slug) return;
        setItem(data);
        if (data && typeof data.id === "string") {
          if (!data.shippingDisabled) setFulfillmentType("ship");
          else if (data.localDeliveryAvailable) setFulfillmentType("local_delivery");
          else if (data.inStorePickupAvailable) setFulfillmentType("pickup");
          const q = Math.max(0, Number(data.quantity) || 0);
          setQuantity((prev) => (q < 1 ? 1 : Math.max(1, Math.min(q, prev))));
        }
      })
      .catch(() => {
        if (currentSlug === slug) setItem(null);
      })
      .finally(() => {
        if (currentSlug === slug) setLoading(false);
      });
  }, [slug]);

  useEffect(() => {
    if (session?.user) {
      fetch("/api/saved?type=store_item")
        .then((r) => r.json())
        .then((items: { referenceId: string }[]) => {
          setSavedIds(new Set(items.map((i) => i.referenceId)));
        })
        .catch(() => {});
    }
  }, [session?.user]);

  useEffect(() => {
    if (!lightboxOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightboxOpen(false);
      const len = item?.photos?.length ?? 0;
      if (len > 1) {
        if (e.key === "ArrowLeft") setSelectedPhotoIndex((i) => (i <= 0 ? len - 1 : i - 1));
        if (e.key === "ArrowRight") setSelectedPhotoIndex((i) => (i >= len - 1 ? 0 : i + 1));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [lightboxOpen, item?.photos?.length]);

  useEffect(() => {
    if (!lightboxDragging) return;
    const onMouseMove = (e: MouseEvent) => {
      const start = lightboxDragStart.current;
      if (!start) return;
      setLightboxPan({
        x: start.panX + (e.clientX - start.x),
        y: start.panY + (e.clientY - start.y),
      });
    };
    const onMouseUp = () => {
      lightboxDragStart.current = null;
      setLightboxDragging(false);
    };
    const onTouchMove = (e: TouchEvent) => {
      const start = lightboxDragStart.current;
      if (!start || e.touches.length !== 1) return;
      e.preventDefault();
      const t = e.touches[0];
      setLightboxPan({
        x: start.panX + (t.clientX - start.x),
        y: start.panY + (t.clientY - start.y),
      });
    };
    const onTouchEnd = () => {
      lightboxDragStart.current = null;
      setLightboxDragging(false);
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
    };
  }, [lightboxDragging]);

  useEffect(() => {
    if (!item?.member?.id || !item.id) {
      setSellerItems([]);
      return;
    }
    const params = new URLSearchParams({ memberId: item.member.id, excludeId: item.id, listingType: "resale" });
    fetch(`/api/store-items?${params}`)
      .then((r) => r.json())
      .then((data) => setSellerItems(Array.isArray(data) ? data : []))
      .catch(() => setSellerItems([]));
  }, [item?.member?.id, item?.id]);

  useEffect(() => {
    if (!item?.id) {
      setSimilarItems([]);
      return;
    }
    const params = new URLSearchParams({ excludeId: item.id, listingType: "resale" });
    if (item.category) params.set("category", item.category);
    fetch(`/api/store-items?${params}`)
      .then((r) => r.json())
      .then((data) => setSimilarItems(Array.isArray(data) ? data : []))
      .catch(() => setSimilarItems([]));
  }, [item?.id, item?.category]);

  const hasVariants = item?.variants && item.variants.length > 0;
  const allVariantsSelected =
    !hasVariants ||
    item!.variants!.every((v) => selectedVariant[v.name] && v.options.includes(selectedVariant[v.name]));

  const effectiveShippingPolicy =
    item?.shippingPolicy ?? item?.member?.sellerShippingPolicy ?? null;
  const effectiveLocalDeliveryPolicy =
    (item as { localDeliveryTerms?: string | null })?.localDeliveryTerms ??
    item?.member?.sellerLocalDeliveryPolicy ??
    null;

  const canAddToCart =
    (fulfillmentType !== "local_delivery" || localDeliveryDetailsSaved) &&
    (fulfillmentType !== "pickup" || pickupDetailsSaved);

  const showPayInCash =
    (fulfillmentType === "pickup" || fulfillmentType === "local_delivery") &&
    item?.member?.acceptCashForPickupDelivery !== false;

  const sellerId = item?.memberId ?? item?.member?.id;
  const isOwnListing = Boolean(
    session?.user?.id && sellerId && session.user.id === sellerId
  );
  const showBuyerActions = Boolean(session?.user && item && !isOwnListing);

  async function handleAddToCart() {
    if (!item || quantity < 1 || quantity > (Math.max(0, Number(item.quantity) || 0))) return;
    if (hasVariants && !allVariantsSelected) {
      setError("Please select all options before adding to cart.");
      return;
    }
    if (fulfillmentType === "local_delivery" && !localDeliveryDetailsSaved) {
      setError("Complete delivery details and agree to terms.");
      setLocalDeliveryModalOpen(true);
      return;
    }
    if (fulfillmentType === "pickup" && !pickupDetailsSaved) {
      setError("Complete the Pick Up Form.");
      setPickupModalOpen(true);
      return;
    }
    setError("");
    setAddingToCart(true);
    try {
      const body: {
        storeItemId: string;
        quantity: number;
        variant?: Record<string, string>;
        fulfillmentType?: FulfillmentType;
        localDeliveryDetails?: LocalDeliveryDetails & { termsAcceptedAt?: string };
        pickupDetails?: PickupDetails & { termsAcceptedAt?: string };
      } = {
        storeItemId: item.id,
        quantity,
        variant: Object.keys(selectedVariant).length > 0 ? selectedVariant : undefined,
        fulfillmentType,
      };
      if (fulfillmentType === "local_delivery" && localDeliveryForm && localDeliveryDetailsSaved) {
        body.localDeliveryDetails = {
          firstName: localDeliveryForm.firstName ?? "",
          lastName: localDeliveryForm.lastName ?? "",
          phone: localDeliveryForm.phone ?? "",
          deliveryAddress: localDeliveryForm.deliveryAddress ?? { street: "", city: "", state: "", zip: "" },
          note: localDeliveryForm.note ?? "",
          termsAcceptedAt: new Date().toISOString(),
        };
      }
      if (fulfillmentType === "pickup" && pickupForm && pickupDetailsSaved) {
        body.pickupDetails = {
          ...pickupForm,
          firstName: pickupForm.firstName ?? "",
          lastName: pickupForm.lastName ?? "",
          phone: pickupForm.phone ?? "",
          email: pickupForm.email ?? "",
          preferredPickupTime: pickupForm.preferredPickupTime ?? "",
          note: pickupForm.note ?? "",
          termsAcceptedAt: (pickupForm as PickupDetails & { termsAcceptedAt?: string }).termsAcceptedAt ?? new Date().toISOString(),
        };
      }
      const res = await fetch("/api/cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError((d as { error?: string }).error ?? "Failed to add to cart");
        return;
      }
      refresh();
      setCartOpen(true);
    } finally {
      setAddingToCart(false);
    }
  }

  async function handleCheckout() {
    if (!item || quantity < 1 || quantity > (Math.max(0, Number(item.quantity) || 0))) return;
    if (hasVariants && !allVariantsSelected) {
      setError("Please select all options before checkout.");
      return;
    }
    if (fulfillmentType === "local_delivery" && !localDeliveryDetailsSaved) {
      setError("Complete delivery details and agree to terms.");
      setLocalDeliveryModalOpen(true);
      return;
    }
    if (fulfillmentType === "pickup" && !pickupDetailsSaved) {
      setError("Complete the Pick Up Form.");
      setPickupModalOpen(true);
      return;
    }
    setError("");
    setCheckingOut(true);
    try {
      const items = [
        {
          storeItemId: item.id,
          quantity,
          variant: Object.keys(selectedVariant).length > 0 ? selectedVariant : undefined,
          fulfillmentType,
        },
      ];
      const body: {
        items: typeof items;
        shippingCostCents?: number;
        shippingAddress?: unknown;
        localDeliveryDetails?: LocalDeliveryDetails & { termsAcceptedAt?: string };
        pickupDetails?: PickupDetails & { termsAcceptedAt?: string };
      } = {
        items,
        shippingCostCents: fulfillmentType === "ship" ? (item.shippingCostCents ?? 0) : 0,
        shippingAddress: undefined,
      };
      if (fulfillmentType === "local_delivery" && localDeliveryForm && localDeliveryDetailsSaved) {
        body.localDeliveryDetails = {
          firstName: localDeliveryForm.firstName ?? "",
          lastName: localDeliveryForm.lastName ?? "",
          phone: localDeliveryForm.phone ?? "",
          deliveryAddress: localDeliveryForm.deliveryAddress ?? { street: "", city: "", state: "", zip: "" },
          note: localDeliveryForm.note ?? "",
          termsAcceptedAt: new Date().toISOString(),
        };
      }
      if (fulfillmentType === "pickup" && pickupForm && pickupDetailsSaved) {
        body.pickupDetails = {
          ...pickupForm,
          firstName: pickupForm.firstName ?? "",
          lastName: pickupForm.lastName ?? "",
          phone: pickupForm.phone ?? "",
          email: pickupForm.email ?? "",
          preferredPickupTime: pickupForm.preferredPickupTime ?? "",
          note: pickupForm.note ?? "",
          termsAcceptedAt: (pickupForm as PickupDetails & { termsAcceptedAt?: string }).termsAcceptedAt ?? new Date().toISOString(),
        };
      }

      if (showPayInCash && paymentMethod === "cash") {
        const res = await fetch("/api/store-orders/cash-checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: body.items,
            localDeliveryDetails: body.localDeliveryDetails,
            pickupDetails: body.pickupDetails,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(getErrorMessage(data.error, "Checkout failed"));
          return;
        }
        if (data.url) {
          window.location.href = data.url;
        }
        return;
      }

      const res = await fetch("/api/stripe/storefront-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(getErrorMessage(data.error, "Checkout failed"));
        return;
      }
      if (data.url) {
        window.location.href = data.url;
      }
    } finally {
      setCheckingOut(false);
    }
  }

  async function handleMakeOffer(e: React.FormEvent) {
    e.preventDefault();
    if (!item) return;
    setOfferError("");
    const amountCents = Math.round(parseFloat(offerAmountDollars) * 100);
    if (isNaN(amountCents) || amountCents < 1) {
      setOfferError("Enter a valid amount");
      return;
    }
    setOfferSubmitting(true);
    try {
      const res = await fetch("/api/resale-offers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeItemId: item.id,
          amountCents,
          message: offerMessage.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setOfferError(data.error ?? "Failed to submit offer");
        return;
      }
      setMakeOfferOpen(false);
      setOfferAmountDollars("");
      setOfferMessage("");
      alert("Offer sent! The seller will respond in New Offers.");
    } finally {
      setOfferSubmitting(false);
    }
  }

  async function handleMessageSeller(e: React.FormEvent) {
    e.preventDefault();
    if (!item) return;
    setMessageError("");
    if (!messageContent.trim()) {
      setMessageError("Enter a message");
      return;
    }
    setMessageSubmitting(true);
    try {
      const res = await fetch("/api/resale-messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeItemId: item.id,
          content: messageContent.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessageError(data.error ?? "Failed to send message");
        return;
      }
      setMessageSellerOpen(false);
      setMessageContent("");
      const convId = data.conversationId;
      if (convId) {
        window.location.href = `/my-community/messages?conversation=${convId}`;
      }
    } finally {
      setMessageSubmitting(false);
    }
  }

  if (loading) {
    return (
      <section className="py-12 px-4" style={{ padding: "var(--section-padding)" }}>
        <div className="max-w-[var(--max-width)] mx-auto">
          <p className="text-gray-500">Loading…</p>
        </div>
      </section>
    );
  }

  if (!item) {
    return (
      <section className="py-12 px-4" style={{ padding: "var(--section-padding)" }}>
        <div className="max-w-[var(--max-width)] mx-auto">
          <p className="text-gray-500">Product not found.</p>
          <Link href={RESALE_BASE} className="btn mt-4 inline-block">
            Back to Resale
          </Link>
        </div>
      </section>
    );
  }

  const photos = item.photos ?? [];
  const safePhotoIndex = photos.length > 0 ? Math.min(selectedPhotoIndex, photos.length - 1) : 0;
  const mainPhoto = photos[safePhotoIndex] ?? photos[0];
  const priceCents = Number(item.priceCents) || 0;
  const priceFormatted = (priceCents / 100).toFixed(2);
  const itemQuantity = Math.max(0, Number(item.quantity) || 0);
  const pointsEarned = Math.floor((priceCents * (quantity >= 1 ? quantity : 1)) / 200);

  return (
    <section className="py-12 px-4" style={{ padding: "var(--section-padding)" }}>
      <div className="max-w-[var(--max-width)] mx-auto">
        <Link href={RESALE_BASE} className="text-sm text-gray-600 hover:underline mb-4 inline-block">
          ← Back to Resale
        </Link>

        {/* Photo lightbox - same as storefront */}
        {lightboxOpen && photos.length > 0 && (
          <div
            className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center"
            onClick={() => setLightboxOpen(false)}
            role="dialog"
            aria-modal="true"
            aria-label="Image gallery"
          >
            <div
              className="relative max-w-[95vw] max-h-[95vh] flex items-center justify-center"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => setLightboxOpen(false)}
                className="absolute top-4 right-4 z-10 w-10 h-10 rounded-full bg-white/20 hover:bg-white/30 text-white flex items-center justify-center text-2xl leading-none"
                aria-label="Close"
              >
                ×
              </button>
              {photos.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedPhotoIndex((i) => (i <= 0 ? photos.length - 1 : i - 1));
                      setLightboxZoom(1);
                      setLightboxPan({ x: 0, y: 0 });
                    }}
                    className="absolute left-2 top-1/2 -translate-y-1/2 z-10 w-12 h-12 rounded-full bg-white/20 hover:bg-white/30 text-white flex items-center justify-center text-2xl"
                    aria-label="Previous image"
                  >
                    ‹
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedPhotoIndex((i) => (i >= photos.length - 1 ? 0 : i + 1));
                      setLightboxZoom(1);
                      setLightboxPan({ x: 0, y: 0 });
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 z-10 w-12 h-12 rounded-full bg-white/20 hover:bg-white/30 text-white flex items-center justify-center text-2xl"
                    aria-label="Next image"
                  >
                    ›
                  </button>
                </>
              )}
              <div
                className="overflow-auto max-h-[95vh] max-w-[95vw] flex items-center justify-center p-12 select-none"
                style={{
                  cursor: lightboxZoom > 1 && lightboxDragging ? "grabbing" : lightboxZoom > 1 ? "grab" : "default",
                }}
                onMouseDown={(e) => {
                  if (lightboxZoom <= 1 || e.button !== 0) return;
                  e.preventDefault();
                  lightboxDragStart.current = {
                    x: e.clientX,
                    y: e.clientY,
                    panX: lightboxPan.x,
                    panY: lightboxPan.y,
                  };
                  setLightboxDragging(true);
                }}
                onTouchStart={(e) => {
                  if (lightboxZoom <= 1 || e.touches.length !== 1) return;
                  const t = e.touches[0];
                  lightboxDragStart.current = {
                    x: t.clientX,
                    y: t.clientY,
                    panX: lightboxPan.x,
                    panY: lightboxPan.y,
                  };
                  setLightboxDragging(true);
                }}
              >
                <img
                  src={photos[safePhotoIndex] ?? photos[0]}
                  alt={`${item.title} ${safePhotoIndex + 1} of ${photos.length}`}
                  className="max-w-full max-h-[calc(95vh-5rem)] w-auto h-auto object-contain touch-none"
                  style={{
                    transform: `translate(${lightboxPan.x}px, ${lightboxPan.y}px) scale(${lightboxZoom})`,
                    transformOrigin: "center center",
                  }}
                  onClick={(e) => e.stopPropagation()}
                  draggable={false}
                />
              </div>
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 rounded-full bg-black/50 px-4 py-2">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setLightboxZoom((z) => {
                      const next = Math.max(0.5, z - 0.5);
                      if (next === 1) setLightboxPan({ x: 0, y: 0 });
                      return next;
                    });
                  }}
                  className="text-white hover:bg-white/20 w-8 h-8 rounded flex items-center justify-center"
                  aria-label="Zoom out"
                >
                  −
                </button>
                <span className="text-white text-sm tabular-nums min-w-[4rem] text-center">
                  {Math.round(lightboxZoom * 100)}%
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setLightboxZoom((z) => Math.min(3, z + 0.5));
                  }}
                  className="text-white hover:bg-white/20 w-8 h-8 rounded flex items-center justify-center"
                  aria-label="Zoom in"
                >
                  +
                </button>
                {photos.length > 1 && (
                  <span className="text-white/80 text-sm ml-2 border-l border-white/40 pl-2">
                    {safePhotoIndex + 1} / {photos.length}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Local Delivery modal - same as storefront */}
        <LocalDeliveryModal
          open={!!item && localDeliveryModalOpen}
          onClose={() => setLocalDeliveryModalOpen(false)}
          policyText={effectiveLocalDeliveryPolicy ?? undefined}
          initialForm={{
            firstName: localDeliveryForm.firstName ?? "",
            lastName: localDeliveryForm.lastName ?? "",
            phone: localDeliveryForm.phone ?? "",
            deliveryAddress: {
              street: localDeliveryForm.deliveryAddress?.street ?? "",
              city: localDeliveryForm.deliveryAddress?.city ?? "",
              state: localDeliveryForm.deliveryAddress?.state ?? "",
              zip: localDeliveryForm.deliveryAddress?.zip ?? "",
            },
            note: localDeliveryForm.note ?? "",
          }}
          onSave={(form) => {
            setLocalDeliveryForm(form);
            setLocalDeliveryDetailsSaved(true);
            setLocalDeliveryModalOpen(false);
          }}
        />
        <PickupTermsModal
          open={!!item && pickupModalOpen}
          onClose={() => setPickupModalOpen(false)}
          policyText={item?.pickupTerms ?? item?.member?.sellerPickupPolicy ?? undefined}
          initialForm={{
            firstName: pickupForm.firstName ?? "",
            lastName: pickupForm.lastName ?? "",
            phone: pickupForm.phone ?? "",
            email: pickupForm.email ?? "",
            preferredPickupTime: pickupForm.preferredPickupTime ?? "",
            note: pickupForm.note ?? "",
          }}
          onSave={(form) => {
            setPickupForm(form);
            setPickupDetailsSaved(true);
            setPickupModalOpen(false);
          }}
        />

        {/* Make offer modal */}
        {item && makeOfferOpen && (
          <div
            className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-4"
            onClick={() => setMakeOfferOpen(false)}
            role="dialog"
            aria-modal="true"
            aria-label="Make an offer"
          >
            <div
              className="bg-white rounded-lg shadow-xl max-w-md w-full p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-xl font-semibold mb-4">Make an offer</h2>
              <form onSubmit={handleMakeOffer} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Your offer ($) *</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={offerAmountDollars}
                    onChange={(e) => setOfferAmountDollars(e.target.value)}
                    className="w-full border rounded px-3 py-2"
                    placeholder="Enter amount"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Message (optional)</label>
                  <textarea
                    value={offerMessage}
                    onChange={(e) => setOfferMessage(e.target.value)}
                    className="w-full border rounded px-3 py-2 text-sm"
                    rows={3}
                    placeholder="Add a note to the seller..."
                  />
                </div>
                {offerError && <p className="text-red-600 text-sm">{offerError}</p>}
                <div className="flex gap-2">
                  <button type="submit" disabled={offerSubmitting} className="btn">
                    {offerSubmitting ? "Sending…" : "Send offer"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setMakeOfferOpen(false)}
                    className="border rounded px-4 py-2 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Message seller modal */}
        {item && messageSellerOpen && (
          <div
            className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-4"
            onClick={() => setMessageSellerOpen(false)}
            role="dialog"
            aria-modal="true"
            aria-label="Message Seller"
          >
            <div
              className="bg-white rounded-lg shadow-xl max-w-md w-full p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-xl font-semibold mb-4">Message Seller</h2>
              <form onSubmit={handleMessageSeller} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Your message *</label>
                  <textarea
                    value={messageContent}
                    onChange={(e) => setMessageContent(e.target.value)}
                    className="w-full border rounded px-3 py-2 text-sm"
                    rows={4}
                    placeholder="Ask a question about this item..."
                  />
                </div>
                {messageError && <p className="text-red-600 text-sm">{messageError}</p>}
                <div className="flex gap-2">
                  <button type="submit" disabled={messageSubmitting} className="btn">
                    {messageSubmitting ? "Sending…" : "Send message"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setMessageSellerOpen(false)}
                    className="border rounded px-4 py-2 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Product Details */}
        <div
          className="rounded-lg border-2 p-6 mb-12"
          style={{ borderColor: "#C9A86C" }}
        >
          <div className="grid md:grid-cols-2 gap-8 min-h-[480px]">
          <div className="relative">
            <div className="absolute top-0 right-0 z-10 flex gap-2">
              <ShareButton type="store_item" id={item.id} slug={item.slug} listingType="resale" title={item.title} className="p-2 rounded border border-gray-300 bg-white hover:bg-gray-50 shrink-0" />
              <HeartSaveButton type="store_item" referenceId={item.id} initialSaved={savedIds.has(item.id)} className="shrink-0" />
            </div>
            {mainPhoto ? (
              <button
                type="button"
                onClick={() => {
                  if (photos.length > 0) {
                    setLightboxZoom(1);
                    setLightboxPan({ x: 0, y: 0 });
                    setLightboxOpen(true);
                  }
                }}
                className="w-full aspect-square max-h-[560px] bg-gray-100 rounded-lg overflow-hidden mb-3 block text-left focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:ring-offset-2 cursor-zoom-in"
              >
                <img
                  src={mainPhoto}
                  alt={item.title}
                  className="w-full h-full object-contain"
                />
              </button>
            ) : (
              <div className="w-full aspect-square max-h-[560px] bg-gray-100 rounded-lg flex items-center justify-center text-gray-400 shrink-0">
                No image
              </div>
            )}
            {photos.length > 1 && (
              <div className="flex gap-2 overflow-x-auto pb-2">
                {photos.map((url, i) => (
                  <button
                    key={`${url}-${i}`}
                    type="button"
                    onClick={() => setSelectedPhotoIndex(i)}
                    className={`shrink-0 w-16 h-16 rounded border-2 overflow-hidden ${
                      safePhotoIndex === i
                        ? "border-[var(--color-primary)]"
                        : "border-gray-300 hover:border-gray-400"
                    }`}
                  >
                    <img src={url} alt="" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>
          <div>
            <h1 className="text-3xl font-bold mb-1">{item.title}</h1>
            {item.category && (
              <p className="text-sm text-gray-500 mb-2">{item.category}</p>
            )}
            {item.business ? (
              <Link
                href={`/support-local/${item.business.slug}`}
                className="text-[var(--color-link)] hover:underline text-sm"
              >
                {item.business.name}
              </Link>
            ) : item.member ? (
              <p className="text-sm text-gray-600">
                Sold by {item.member.firstName} {item.member.lastName}
              </p>
            ) : null}
            <p className="text-2xl font-bold mt-4">${priceFormatted}</p>

            {/* Delivery options */}
            {(item.shippingDisabled || item.localDeliveryAvailable || item.inStorePickupAvailable) && (
              <div className="mt-4 space-y-2">
                <label className="block text-sm font-medium">How do you want to receive this item?</label>
                <div className="flex flex-wrap gap-2">
                  {!item.shippingDisabled && (
                    <button
                      type="button"
                      onClick={() => setFulfillmentType("ship")}
                      className={`border rounded px-3 py-1.5 text-sm ${
                        fulfillmentType === "ship"
                          ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
                          : "border-gray-300 hover:border-gray-400"
                      }`}
                    >
                      Ship
                      {item.shippingCostCents != null && item.shippingCostCents > 0
                        ? ` ($${(item.shippingCostCents / 100).toFixed(2)})`
                        : " (free)"}
                    </button>
                  )}
                  {item.localDeliveryAvailable && (
                    <button
                      type="button"
                      onClick={() => {
                        setFulfillmentType("local_delivery");
                        setLocalDeliveryModalOpen(true);
                      }}
                      className={`border rounded px-3 py-1.5 text-sm ${
                        fulfillmentType === "local_delivery"
                          ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
                          : "border-gray-300 hover:border-gray-400"
                      }`}
                    >
                      Deliver Locally
                      {item.localDeliveryFeeCents != null && item.localDeliveryFeeCents > 0
                        ? ` ($${(item.localDeliveryFeeCents / 100).toFixed(2)})`
                        : " (No Fee)"}
                    </button>
                  )}
                  {item.inStorePickupAvailable && (
                    <button
                      type="button"
                      onClick={() => {
                        setFulfillmentType("pickup");
                        setPickupModalOpen(true);
                      }}
                      className={`border rounded px-3 py-1.5 text-sm ${
                        fulfillmentType === "pickup"
                          ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
                          : "border-gray-300 hover:border-gray-400"
                      }`}
                    >
                      Arrange Pickup (No Fee)
                    </button>
                  )}
                </div>
                {fulfillmentType === "local_delivery" && !localDeliveryDetailsSaved && (
                  <p className="text-amber-600 text-sm">
                    Complete delivery details and agree to terms below to add to cart.
                  </p>
                )}
                {fulfillmentType === "pickup" && !pickupDetailsSaved && (
                  <p className="text-amber-600 text-sm">
                    Complete the Pick Up Form below to add to cart.
                  </p>
                )}
              </div>
            )}
            {(!item.shippingDisabled && !item.localDeliveryAvailable && !item.inStorePickupAvailable) && (
              <>
                {item.shippingCostCents != null && item.shippingCostCents > 0 ? (
                  <p className="text-sm text-gray-500 mt-1">
                    Shipping: ${(item.shippingCostCents / 100).toFixed(2)}
                  </p>
                ) : (
                  <p className="text-sm text-gray-500 mt-1">Free Shipping</p>
                )}
              </>
            )}
            {fulfillmentType === "ship" && item.shippingCostCents != null && item.shippingCostCents > 0 && (
              <p className="text-sm text-gray-500 mt-1">Shipping: ${(item.shippingCostCents / 100).toFixed(2)}</p>
            )}
            {fulfillmentType === "local_delivery" && item.localDeliveryFeeCents != null && item.localDeliveryFeeCents > 0 && (
              <p className="text-sm text-gray-500 mt-1">Local Delivery: ${(item.localDeliveryFeeCents / 100).toFixed(2)}</p>
            )}
            {fulfillmentType === "pickup" && (item.pickupTerms ?? item.member?.sellerPickupPolicy) && (
              <div className="mt-2 p-3 bg-gray-50 rounded border border-gray-200 text-sm">
                <strong>Seller&apos;s pickup policy:</strong>
                <div className="mt-1 whitespace-pre-wrap text-gray-700">{item.pickupTerms ?? item.member?.sellerPickupPolicy}</div>
              </div>
            )}

            {/* Payment options */}
            <div className="mt-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Payment</label>
              {showPayInCash ? (
                <div className="space-y-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="paymentMethod"
                      checked={paymentMethod === "card"}
                      onChange={() => setPaymentMethod("card")}
                      style={{ accentColor: "var(--color-primary)" }}
                    />
                    <span className="text-sm">Pay by Card</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="paymentMethod"
                      checked={paymentMethod === "cash"}
                      onChange={() => setPaymentMethod("cash")}
                      style={{ accentColor: "var(--color-primary)" }}
                    />
                    <span className="text-sm">Pay in Cash</span>
                  </label>
                  <p className="text-sm text-gray-500 mt-1">
                    Pay in Cash when you pick up or receive local delivery.
                  </p>
                </div>
              ) : (
                <p className="text-sm text-gray-600">
                  Pay by Card at checkout.
                  {(item.localDeliveryAvailable || item.inStorePickupAvailable) && item.member?.acceptCashForPickupDelivery !== false && (
                    <> Pay in Cash available for pickup or local delivery.</>
                  )}
                </p>
              )}
            </div>

            {item.variants && item.variants.length > 0 && (
              <div className="mt-6 space-y-3">
                {item.variants.map((v, vi) => (
                  <div key={vi}>
                    <label className="block text-sm font-medium mb-1">{v.name} *</label>
                    <div className="flex flex-wrap gap-2">
                      {v.options.map((opt) => (
                        <button
                          key={opt}
                          type="button"
                          onClick={() =>
                            setSelectedVariant((prev) => ({ ...prev, [v.name]: opt }))
                          }
                          className={`border rounded px-3 py-1.5 text-sm ${
                            selectedVariant[v.name] === opt
                              ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
                              : "border-gray-300 hover:border-gray-400"
                          }`}
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {itemQuantity > 1 && (
              <div className="mt-6">
                <label className="block text-sm font-medium mb-1">Quantity *</label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setQuantity(Math.max(1, quantity - 1))}
                    className="w-10 h-10 border rounded flex items-center justify-center text-lg"
                  >
                    −
                  </button>
                  <input
                    type="number"
                    min={1}
                    max={itemQuantity}
                    value={quantity}
                    onChange={(e) =>
                      setQuantity(
                        Math.max(1, Math.min(itemQuantity, parseInt(e.target.value, 10) || 1))
                      )
                    }
                    className="border rounded px-3 py-2 w-20 text-center"
                  />
                  <button
                    type="button"
                    onClick={() => setQuantity(Math.min(itemQuantity, quantity + 1))}
                    className="w-10 h-10 border rounded flex items-center justify-center text-lg"
                  >
                    +
                  </button>
                </div>
                <p className="text-sm text-gray-500 mt-1">{itemQuantity} in stock</p>
              </div>
            )}
            {error && <p className="text-red-600 text-sm mt-2">{error}</p>}
            {fulfillmentType === "local_delivery" && !canAddToCart && (
              <p className="text-amber-600 text-sm mt-1">Complete delivery details and agree to terms.</p>
            )}
            {fulfillmentType === "pickup" && !canAddToCart && (
              <p className="text-amber-600 text-sm mt-1">Complete the Pick Up Form.</p>
            )}
            {/* Stacked action buttons – same width */}
            <div className="mt-6 space-y-3 max-w-sm">
              {status === "loading" ? (
                <p className="text-gray-500">Loading…</p>
              ) : session?.user ? (
                <>
                  <button
                    type="button"
                    onClick={handleAddToCart}
                    disabled={addingToCart || itemQuantity < 1 || !allVariantsSelected || !canAddToCart}
                    className="btn disabled:opacity-50 w-full py-2.5"
                  >
                    {addingToCart ? "Adding…" : "Add to Cart"}
                  </button>
                  <button
                    type="button"
                    onClick={handleCheckout}
                    disabled={checkingOut || itemQuantity < 1 || !allVariantsSelected || !canAddToCart}
                    className="btn border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50 w-full py-2.5"
                  >
                    {checkingOut ? "Redirecting…" : "Buy It Now"}
                  </button>
                  {showBuyerActions && item.acceptOffers !== false && (
                    <button
                      type="button"
                      onClick={() => setMakeOfferOpen(true)}
                      className="btn border border-gray-300 bg-white hover:bg-gray-50 w-full py-2.5"
                    >
                      Make an Offer
                    </button>
                  )}
                </>
              ) : (
                <Link
                  href={`/login?callbackUrl=${encodeURIComponent(`${RESALE_BASE}/${item.slug}`)}`}
                  className="btn inline-block text-center w-full py-2.5"
                >
                  Sign in to buy
                </Link>
              )}
            </div>

            {/* Message Seller – mini section in green box */}
            {showBuyerActions && (
              <div
                className="mt-6 rounded-lg border-2 p-4"
                style={{ borderColor: "var(--color-primary)" }}
              >
                <label className="block text-sm font-medium text-gray-700 mb-1">Send Message to Seller</label>
                <form onSubmit={handleMessageSeller} className="space-y-2">
                  <textarea
                    value={messageContent}
                    onChange={(e) => setMessageContent(e.target.value)}
                    className="w-full border rounded px-3 py-2 text-sm min-h-[80px]"
                    rows={3}
                    placeholder="Ask a question about this item..."
                  />
                  {messageError && <p className="text-red-600 text-sm">{messageError}</p>}
                  <button type="submit" disabled={messageSubmitting} className="btn text-sm py-2">
                    {messageSubmitting ? "Sending…" : "Send"}
                  </button>
                </form>
              </div>
            )}

            <p className="text-sm text-gray-500 mt-2">
              Earn {pointsEarned} Community Points with this purchase
            </p>
          </div>
          </div>
          <div className="mt-8 pt-8 border-t border-gray-200">
            <h2 className="text-xl font-bold mb-3">Item Description</h2>
            <p className="text-gray-600 whitespace-pre-wrap">{item.description?.trim() || "No description provided."}</p>
          </div>
        </div>

        {/* Store Information - same as storefront */}
        {item.business && (
          <div className="border rounded-lg overflow-hidden mb-8">
            <div
              className="px-6 py-3 text-white font-semibold"
              style={{ backgroundColor: "var(--color-primary)" }}
            >
              Store Information
            </div>
            <div className="p-6 bg-gray-50">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6 items-stretch">
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Company Name</label>
                    <div className="border-2 rounded-lg px-3 py-2.5 bg-white text-gray-900 min-h-[2.75rem] flex items-center" style={{ borderColor: "#C9A86C" }}>
                      {item.business.name || "—"}
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Store Description</label>
                    <div className="border-2 rounded-lg p-3 bg-white text-sm text-gray-900 max-h-40 overflow-y-auto min-h-[6rem]" style={{ borderColor: "#C9A86C", scrollbarWidth: "thin" }}>
                      {item.business.fullDescription || "—"}
                    </div>
                  </div>
                </div>
                <div className="flex flex-col order-first md:order-none">
                  <div className="w-full shrink-0">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Company Phone Number</label>
                    <div className="border-2 rounded-lg px-3 py-2.5 bg-white text-gray-900 min-h-[2.75rem] flex items-center" style={{ borderColor: "#C9A86C" }}>
                      {item.business.phone || "—"}
                    </div>
                  </div>
                  <div className="flex justify-center items-center w-full mt-6 min-h-0 flex-1">
                    {item.business.logoUrl ? (
                      <img src={item.business.logoUrl} alt={item.business.name || "Store"} className="w-[9.72rem] h-[9.72rem] md:w-[10.8rem] md:h-[10.8rem] rounded-full object-cover border-2 flex-shrink-0" style={{ borderColor: "#C9A86C" }} />
                    ) : (
                      <div className="w-[9.72rem] h-[9.72rem] md:w-[10.8rem] md:h-[10.8rem] rounded-full bg-gray-200 flex items-center justify-center text-gray-500 text-sm flex-shrink-0" style={{ borderWidth: 2, borderStyle: "solid", borderColor: "#C9A86C" }}>
                        No logo
                      </div>
                    )}
                  </div>
                </div>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Contact Email</label>
                    <div className="border-2 rounded-lg px-3 py-2.5 bg-white text-gray-900 min-h-[2.75rem] flex items-center break-all" style={{ borderColor: "#C9A86C" }}>
                      {item.business.email || "—"}
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Business Website</label>
                    <div className="border-2 rounded-lg px-3 py-2.5 bg-white min-h-[2.75rem] flex items-center" style={{ borderColor: "#C9A86C" }}>
                      {item.business.website ? (
                        <a href={item.business.website} target="_blank" rel="noopener noreferrer" className="text-[var(--color-link)] hover:underline break-all">
                          {item.business.website}
                        </a>
                      ) : (
                        <span className="text-gray-900">—</span>
                      )}
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Storefront Address</label>
                    <div className="border-2 rounded-lg px-3 py-2.5 bg-white text-gray-900 min-h-[2.75rem] flex items-center" style={{ borderColor: "#C9A86C" }}>
                      {item.business.address || "—"}
                    </div>
                  </div>
                </div>
              </div>
              {item.business.slug && (
                <div className="flex justify-center mt-6">
                  <a href={`/support-local/${item.business.slug}`} target="_blank" rel="noopener noreferrer" className="btn inline-block">
                    View Business Page
                  </a>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Seller Policy - same as storefront */}
        {(effectiveLocalDeliveryPolicy || effectiveShippingPolicy || item.member?.sellerReturnPolicy) && (
          <div className="border rounded-lg overflow-hidden mb-8">
            <div className="px-6 py-3 text-white font-semibold" style={{ backgroundColor: "var(--color-primary)" }}>
              Seller Policy
            </div>
            <div className="p-6 bg-gray-50">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
                {effectiveLocalDeliveryPolicy && (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Local Delivery / Pick Up Policy</label>
                      <div className="border-2 rounded-lg p-3 bg-white text-sm text-gray-900 max-h-[15rem] overflow-y-auto min-h-[9rem]" style={{ borderColor: "#C9A86C", scrollbarWidth: "thin" }}>
                        {effectiveLocalDeliveryPolicy}
                      </div>
                    </div>
                  </div>
                )}
                {effectiveShippingPolicy && (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Shipping Policy</label>
                      <div className="border-2 rounded-lg p-3 bg-white text-sm text-gray-900 max-h-[15rem] overflow-y-auto min-h-[9rem]" style={{ borderColor: "#C9A86C", scrollbarWidth: "thin" }}>
                        {effectiveShippingPolicy}
                      </div>
                    </div>
                  </div>
                )}
                {item.member?.sellerReturnPolicy && (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Return Policy</label>
                      <div className="border-2 rounded-lg p-3 bg-white text-sm text-gray-900 max-h-[15rem] overflow-y-auto min-h-[9rem]" style={{ borderColor: "#C9A86C", scrollbarWidth: "thin" }}>
                        {item.member.sellerReturnPolicy}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* More from this seller */}
        {item && sellerItems.length > 0 && (
          <div className="mt-12 mb-8 flex flex-col items-center rounded-lg border-2 p-6" style={{ borderColor: "var(--color-primary)" }}>
            <h2 className="text-xl font-bold mb-4 text-center w-full">
              More from {item.business?.name ?? "this seller"}
            </h2>
            <div className="flex items-center gap-4 w-full max-w-[var(--max-width)] justify-center">
              <button
                type="button"
                onClick={() => setSellerScrollIndex((i) => Math.max(0, i - 1))}
                disabled={sellerScrollIndex === 0}
                className="shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed text-sm"
                style={{ borderColor: "#C9A86C" }}
                aria-label="Previous"
              >
                ‹
              </button>
              <div className="flex-1 min-w-0 grid grid-cols-2 gap-4 max-w-2xl mx-auto justify-items-center">
                {sellerItems
                  .slice(sellerScrollIndex * ITEMS_PER_SCROLL, sellerScrollIndex * ITEMS_PER_SCROLL + ITEMS_PER_SCROLL)
                  .map((other) => (
                    <Link
                      key={other.id}
                      href={`${RESALE_BASE}/${other.slug}`}
                      className="border-2 rounded-lg overflow-hidden hover:opacity-90 transition-opacity w-full max-w-[14rem] shrink-0"
                      style={{ borderColor: "#C9A86C" }}
                    >
                      <div className="aspect-square bg-gray-100">
                        {other.photos[0] ? (
                          <img src={other.photos[0]} alt={other.title} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-gray-400 text-sm">No image</div>
                        )}
                      </div>
                      <div className="p-2">
                        <p className="text-sm font-medium line-clamp-2">{other.title}</p>
                        <p className="text-sm font-bold mt-0.5">${(other.priceCents / 100).toFixed(2)}</p>
                      </div>
                    </Link>
                  ))}
              </div>
              <button
                type="button"
                onClick={() => setSellerScrollIndex((i) => Math.min(Math.ceil(sellerItems.length / ITEMS_PER_SCROLL) - 1, i + 1))}
                disabled={sellerScrollIndex >= Math.ceil(sellerItems.length / ITEMS_PER_SCROLL) - 1}
                className="shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed text-sm"
                style={{ borderColor: "#C9A86C" }}
                aria-label="Next"
              >
                ›
              </button>
            </div>
          </div>
        )}

      </div>

      {item && (
        <div className="py-10 px-4" style={{ backgroundColor: "var(--color-section-alt)" }}>
          <div className="max-w-[var(--max-width)] mx-auto text-center">
            {/* Plan: reduce font size by 38% (text-3xl 1.875rem → 1.1625rem) */}
            <p className="font-bold mb-2 md:text-xl" style={{ color: "var(--color-heading)", fontSize: "1.1625rem" }}>Thanks for supporting local!</p>
            <p className="mb-6 max-w-xl mx-auto" style={{ color: "var(--color-text)" }}>
              Keep exploring more resale items from the community.
            </p>
            <Link href={keepShoppingHref} className="btn-sponsors inline-block">
              Keep Shopping!
            </Link>
          </div>
        </div>
      )}

      {item && similarItems.length > 0 && (
        <div className="max-w-[var(--max-width)] mx-auto px-4 pt-12 pb-12">
          <div className="flex flex-col items-center rounded-lg border-2 p-6" style={{ borderColor: "var(--color-primary)" }}>
            <h2 className="text-xl font-bold mb-4 w-full text-center">Similar Items from Other Vendors</h2>
            <div className="flex items-center gap-4 w-full justify-center">
              <button
                type="button"
                onClick={() => setMoreLikeThisScrollIndex((i) => Math.max(0, i - 1))}
                disabled={moreLikeThisScrollIndex === 0}
                className="shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed text-sm"
                style={{ borderColor: "#C9A86C" }}
                aria-label="Previous"
              >
                ‹
              </button>
              <div className="flex-1 min-w-0 grid grid-cols-2 gap-4 max-w-2xl mx-auto justify-items-center">
                {similarItems
                  .slice(moreLikeThisScrollIndex * ITEMS_PER_SCROLL, moreLikeThisScrollIndex * ITEMS_PER_SCROLL + ITEMS_PER_SCROLL)
                  .map((other) => (
                    <Link
                      key={`morelike-${other.id}`}
                      href={`${RESALE_BASE}/${other.slug}`}
                      className="border-2 rounded-lg overflow-hidden hover:opacity-90 transition-opacity w-full max-w-[14rem] shrink-0"
                      style={{ borderColor: "#C9A86C" }}
                    >
                      <div className="aspect-square bg-gray-100">
                        {other.photos[0] ? (
                          <img src={other.photos[0]} alt={other.title} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-gray-400 text-sm">No image</div>
                        )}
                      </div>
                      <div className="p-2">
                        <p className="text-sm font-medium line-clamp-2">{other.title}</p>
                        <p className="text-sm font-bold mt-0.5">${(other.priceCents / 100).toFixed(2)}</p>
                      </div>
                    </Link>
                  ))}
              </div>
              <button
                type="button"
                onClick={() => setMoreLikeThisScrollIndex((i) => Math.min(Math.ceil(similarItems.length / ITEMS_PER_SCROLL) - 1, i + 1))}
                disabled={moreLikeThisScrollIndex >= Math.ceil(similarItems.length / ITEMS_PER_SCROLL) - 1}
                className="shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed text-sm"
                style={{ borderColor: "#C9A86C" }}
                aria-label="Next"
              >
                ›
              </button>
            </div>
          </div>
        </div>
      )}

    </section>
  );
}
