"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useLockBodyScroll } from "@/lib/scroll-lock";
import Link from "next/link";
import { CouponForm } from "@/components/CouponForm";
import { EventForm } from "@/components/EventForm";
import { RewardForm } from "@/components/RewardForm";
import { BusinessForm } from "@/components/BusinessForm";
import { DeleteBusinessButton } from "@/components/DeleteBusinessButton";
import { CreatePostModal } from "@/components/CreatePostModal";
import { IonIcon } from "@/components/IonIcon";
import type { Business } from "database";

interface BusinessOption {
  id: string;
  name: string;
  slug?: string;
  logoUrl?: string | null;
}

interface BusinessHubFormModalsProps {
  businesses: BusinessOption[];
  isSeller: boolean;
  /** Seller plan or admin — same gate as `/seller-hub` home. */
  hasSellerHubAccess?: boolean;
  /**
   * `/seller-hub/business-hub` has no main site header — show the in-form “Return to Seller Hub” button.
   */
  sellerHubReturnInForm?: boolean;
  /** Open a hub modal on mount (e.g. ?open=coupon from deep link). */
  initialOpenModal?: "coupon" | "reward" | "event" | null;
}

function possessiveBusinessLine1(name: string): string {
  const t = name.trim();
  if (!t) return "Your";
  return /s$/i.test(t) ? `${t}'` : `${t}'s`;
}

function businessLogoInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) {
    const w = parts[0]!;
    return w.length >= 2 ? w.slice(0, 2).toUpperCase() : w.toUpperCase();
  }
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

const MAX_BUSINESSES = 2;
type OpenModal = null | "coupon" | "event" | "reward" | "business" | "qr-picker" | "create-post-picker";
type BusinessView = "list" | "add" | "edit";

interface BusinessForForm {
  id: string;
  name: string | null;
  shortDescription: string | null;
  fullDescription: string | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  logoUrl: string | null;
  coverPhotoUrl?: string | null;
  address: string | null;
  city: string;
  categories: string[];
  photos: string[];
  hoursOfOperation?: Record<string, string> | null;
}

const modalBackdropClass =
  "fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/50 overflow-hidden";
const modalPanelClass =
  "relative rounded-xl shadow-xl bg-white w-full max-w-2xl max-h-[90vh] overflow-y-auto border-2 border-[var(--color-primary)]";

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className={modalBackdropClass}
      aria-modal="true"
      role="dialog"
      aria-labelledby="business-hub-modal-title"
      onClick={onClose}
    >
      <div
        className={modalPanelClass}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between gap-4 z-10">
          <h2 id="business-hub-modal-title" className="text-xl font-bold">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-gray-600 hover:bg-gray-100"
            aria-label="Close"
          >
            <span className="text-xl leading-none">×</span>
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

/** Same QR as app: fetches /api/businesses/[id]/qr (encodes scan/[businessId] URL). */
function QRCodePopup({
  businessId,
  businessName,
  slug,
  onClose,
}: {
  businessId: string;
  businessName: string;
  slug?: string;
  onClose: () => void;
}) {
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchQR = useCallback(async () => {
    setLoading(true);
    setError(null);
    setImageDataUrl(null);
    try {
      const res = await fetch(`/api/businesses/${businessId}/qr`, { credentials: "include" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
      }
      const blob = await res.blob();
      const reader = new FileReader();
      reader.onloadend = () => setImageDataUrl(reader.result as string);
      reader.readAsDataURL(blob);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load QR code.");
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    fetchQR();
  }, [fetchQR]);

  return (
    <div
      className={modalBackdropClass}
      aria-modal="true"
      role="dialog"
      aria-label="QR Code"
      onClick={onClose}
    >
      <div
        className="relative rounded-xl shadow-xl bg-white w-full max-w-sm overflow-hidden border-2 border-[var(--color-primary)] mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="sticky top-0 px-4 py-3 flex items-center justify-between border-b bg-[var(--color-primary)] text-white"
        >
          <h2 className="text-lg font-bold truncate pr-2">{businessName}</h2>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-white/20"
            aria-label="Close"
          >
            <span className="text-xl leading-none">×</span>
          </button>
        </div>
        <div className="p-6 flex flex-col items-center">
          {loading && (
            <div className="py-12 text-gray-500">Loading QR code…</div>
          )}
          {error && (
            <div className="py-8 text-center">
              <p className="text-red-600 mb-4">{error}</p>
              <button
                type="button"
                onClick={fetchQR}
                className="px-4 py-2 rounded-lg font-semibold text-white"
                style={{ backgroundColor: "var(--color-primary)" }}
              >
                Retry
              </button>
            </div>
          )}
          {imageDataUrl && !loading && (
            <>
              <div className="rounded-xl p-4 border-2 border-[var(--color-primary)] bg-white shadow-md">
                <img
                  src={imageDataUrl}
                  alt={`QR code for ${businessName}`}
                  className="w-64 h-64 object-contain"
                  width={256}
                  height={256}
                />
              </div>
              <p className="text-sm text-gray-600 mt-4 text-center">
                Have your customer scan this code to earn reward points.
              </p>
              <a
                href={`/api/businesses/${businessId}/qr`}
                download={`nwc-qr-${slug ?? businessId}.png`}
                className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg font-semibold text-white"
                style={{ backgroundColor: "var(--color-primary)" }}
              >
                <IonIcon name="download-outline" size={20} />
                Download QR Code
              </a>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function BusinessHubFormModals({
  businesses,
  isSeller,
  hasSellerHubAccess = false,
  sellerHubReturnInForm = false,
  initialOpenModal = null,
}: BusinessHubFormModalsProps) {
  const router = useRouter();
  const [openModal, setOpenModal] = useState<OpenModal>(null);
  const [rewardShowingExplanation, setRewardShowingExplanation] = useState(false);
  const [flyerDownloading, setFlyerDownloading] = useState(false);
  const [businessView, setBusinessView] = useState<BusinessView>("list");
  const [editingBusinessId, setEditingBusinessId] = useState<string | null>(null);
  const [editingBusiness, setEditingBusiness] = useState<BusinessForForm | null>(null);
  const [businessLoading, setBusinessLoading] = useState(false);
  const [qrPopupBusiness, setQrPopupBusiness] = useState<{ id: string; name: string; slug?: string } | null>(null);
  const [createPostOpen, setCreatePostOpen] = useState(false);
  const [createPostBusiness, setCreatePostBusiness] = useState<{ id: string; name: string } | null>(null);
  const [activeBusinessId, setActiveBusinessId] = useState<string | null>(null);
  const [hubSwitcherOpen, setHubSwitcherOpen] = useState(false);
  const [hubLogoLoadFailed, setHubLogoLoadFailed] = useState(false);

  const activeBusiness =
    businesses.find((b) => b.id === activeBusinessId) ?? businesses[0] ?? null;

  useEffect(() => {
    setActiveBusinessId((prev) => {
      if (businesses.length === 0) return null;
      if (prev && businesses.some((b) => b.id === prev)) return prev;
      return businesses[0]!.id;
    });
  }, [businesses]);

  useEffect(() => {
    if (!initialOpenModal) return;
    setOpenModal(initialOpenModal);
  }, [initialOpenModal]);

  useEffect(() => {
    setHubLogoLoadFailed(false);
  }, [activeBusiness?.id]);

  async function handleDownloadFlyer(businessId: string, slug: string) {
    setFlyerDownloading(true);
    try {
      const res = await fetch(`/api/businesses/${businessId}/flyer`, { credentials: "include" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert((data as { error?: string }).error ?? `Download failed (${res.status})`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `nwc-flyer-${slug}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      alert("Download failed. Please try again.");
    } finally {
      setFlyerDownloading(false);
    }
  }

  const closeModal = () => {
    if (openModal === "reward") setRewardShowingExplanation(false);
    if (openModal === "business") {
      setBusinessView("list");
      setEditingBusinessId(null);
      setEditingBusiness(null);
    }
    setOpenModal(null);
    router.refresh();
  };

  const openBusinessModal = () => {
    setBusinessView("list");
    setEditingBusinessId(null);
    setEditingBusiness(null);
    setOpenModal("business");
  };

  const handleBusinessSuccess = () => {
    closeModal();
  };

  const handleBusinessDeleted = () => {
    closeModal();
  };

  async function handleEditBusiness(id: string) {
    setBusinessLoading(true);
    setEditingBusinessId(id);
    try {
      const res = await fetch(`/api/businesses/${id}`, { credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "Failed to load");
      setEditingBusiness(data as BusinessForForm);
      setBusinessView("edit");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to load business");
      setEditingBusinessId(null);
    } finally {
      setBusinessLoading(false);
    }
  }

  useLockBodyScroll(!!openModal || !!qrPopupBusiness || createPostOpen || hubSwitcherOpen);

  const hubCardClass =
    "hub-card w-full min-w-0 border-2 border-[var(--color-primary)] rounded-[10px] p-6 transition text-center hover:bg-[var(--color-section-alt)] flex flex-col items-center";
  const businessCardClass =
    "hub-card w-full min-w-0 border-2 rounded-[10px] p-6 transition text-center hover:bg-[var(--color-section-alt)] border-[var(--color-secondary)] bg-[var(--color-secondary)]/5 flex flex-col items-center";

  const mobileGridTile =
    "flex flex-col items-center justify-center gap-2 min-h-[100px] p-4 rounded-[10px] border-2 bg-white text-center active:bg-gray-50 transition-colors w-full";
  const mobileGridTileStyle = { borderColor: "var(--color-primary)" } as const;

  const sellerHubReturnButton =
    hasSellerHubAccess && sellerHubReturnInForm ? (
    <Link
      href="/seller-hub"
      prefetch={false}
      className="mb-4 flex w-full items-center justify-center gap-2 rounded-[10px] px-4 py-3 text-center text-sm font-semibold text-white no-underline shadow-sm transition hover:opacity-95 active:opacity-90"
      style={{ backgroundColor: "var(--color-primary)" }}
    >
      <IonIcon name="arrow-back-outline" size={20} className="text-white shrink-0" />
      Return to Seller Hub
    </Link>
  ) : null;

  return (
    <>
      <div
        className="lg:hidden px-4 pt-4 pb-10"
        style={{ paddingBottom: "max(2.5rem, env(safe-area-inset-bottom))" }}
      >
        <div
          className="flex flex-row items-center gap-4 mb-6 py-4 px-4 rounded-xl border-2"
          style={{
            backgroundColor: "var(--color-section-alt)",
            borderColor: "var(--color-primary)",
          }}
        >
          <div className="flex-1 min-w-0">
            {businesses.length === 0 ? (
              <>
                <p
                  className="text-[17px] font-bold mb-0.5"
                  style={{ fontFamily: "var(--font-heading)", color: "var(--color-heading)" }}
                >
                  Your
                </p>
                <h1
                  className="text-xl font-bold mb-1.5"
                  style={{ fontFamily: "var(--font-heading)", color: "var(--color-heading)" }}
                >
                  Business Hub
                </h1>
              </>
            ) : businesses.length === 1 ? (
              <>
                <p
                  className="text-[17px] font-bold mb-0.5"
                  style={{ fontFamily: "var(--font-heading)", color: "var(--color-heading)" }}
                >
                  {possessiveBusinessLine1(activeBusiness?.name ?? "")}
                </p>
                <h1
                  className="text-xl font-bold mb-1.5"
                  style={{ fontFamily: "var(--font-heading)", color: "var(--color-heading)" }}
                >
                  Business Hub
                </h1>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setHubSwitcherOpen(true)}
                  className="flex flex-row items-center gap-1.5 mb-0.5 self-start"
                >
                  <span
                    className="text-[17px] font-bold"
                    style={{ fontFamily: "var(--font-heading)", color: "var(--color-heading)" }}
                  >
                    {possessiveBusinessLine1(activeBusiness?.name ?? "")}
                  </span>
                  <IonIcon name="chevron-down" size={20} className="text-[var(--color-primary)] shrink-0" />
                </button>
                <h1
                  className="text-xl font-bold mb-1.5"
                  style={{ fontFamily: "var(--font-heading)", color: "var(--color-heading)" }}
                >
                  Business Hub
                </h1>
              </>
            )}
            <p className="text-sm leading-5" style={{ color: "var(--color-text)" }}>
              Give residents a reason to support local. Offer Coupons, Rewards, & Post Events
            </p>
          </div>
          <div className="shrink-0 flex justify-center items-center min-w-[94px]">
            <div
              className="flex items-center justify-center overflow-hidden border-2 rounded-full bg-white w-[94px] h-[94px]"
              style={{ borderColor: "var(--color-primary)" }}
            >
              {(() => {
                const rawLogo =
                  businesses.length > 0 && activeBusiness?.logoUrl?.trim() && !hubLogoLoadFailed
                    ? activeBusiness.logoUrl.trim()
                    : null;
                if (rawLogo) {
                  return (
                    <img
                      src={rawLogo}
                      alt={activeBusiness ? `${activeBusiness.name} logo` : "Business logo"}
                      className="w-full h-full object-contain"
                      onError={() => setHubLogoLoadFailed(true)}
                    />
                  );
                }
                return (
                  <span
                    className="text-[28px] font-bold leading-none"
                    style={{ color: "var(--color-primary)", fontFamily: "var(--font-heading)" }}
                  >
                    {activeBusiness != null ? businessLogoInitials(activeBusiness.name) : "?"}
                  </span>
                );
              })()}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={openBusinessModal}
            className={mobileGridTile}
            style={mobileGridTileStyle}
          >
            <IonIcon name="business" size={28} className="text-[var(--color-primary)]" />
            <span
              className="text-sm font-semibold text-center leading-tight"
              style={{ color: "var(--color-heading)" }}
            >
              Set up / Edit Business Page
            </span>
          </button>
          {businesses.length > 0 && (
            <button
              type="button"
              onClick={() => {
                if (businesses.length === 1) {
                  const biz = businesses[0]!;
                  setCreatePostBusiness({ id: biz.id, name: biz.name });
                  setCreatePostOpen(true);
                } else {
                  setOpenModal("create-post-picker");
                }
              }}
              className={mobileGridTile}
              style={mobileGridTileStyle}
            >
              <IonIcon name="megaphone" size={28} className="text-[var(--color-primary)]" />
              <span
                className="text-sm font-semibold text-center leading-tight"
                style={{ color: "var(--color-heading)" }}
              >
                Create Post
              </span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setOpenModal("event")}
            className={mobileGridTile}
            style={mobileGridTileStyle}
          >
            <IonIcon name="calendar" size={28} className="text-[var(--color-primary)]" />
            <span
              className="text-sm font-semibold text-center leading-tight"
              style={{ color: "var(--color-heading)" }}
            >
              Post Event
            </span>
          </button>
          <button
            type="button"
            onClick={() => setOpenModal("coupon")}
            className={mobileGridTile}
            style={mobileGridTileStyle}
          >
            <IonIcon name="pricetag" size={28} className="text-[var(--color-primary)]" />
            <span
              className="text-sm font-semibold text-center leading-tight"
              style={{ color: "var(--color-heading)" }}
            >
              Create Coupon
            </span>
          </button>
          <button
            type="button"
            onClick={() => setOpenModal("reward")}
            className={mobileGridTile}
            style={mobileGridTileStyle}
          >
            <IonIcon name="gift" size={28} className="text-[var(--color-primary)]" />
            <span
              className="text-sm font-semibold text-center leading-tight"
              style={{ color: "var(--color-heading)" }}
            >
              Offer a Reward
            </span>
          </button>
          <Link
            href="/business-hub/reward-redemptions"
            prefetch={false}
            className={mobileGridTile + " no-underline"}
            style={mobileGridTileStyle}
          >
            <IonIcon name="receipt-outline" size={28} className="text-[var(--color-primary)]" />
            <span
              className="text-sm font-semibold text-center leading-tight"
              style={{ color: "var(--color-heading)" }}
            >
              Redeemed Rewards
            </span>
          </Link>
        </div>

        <div className="mt-6 flex flex-col items-stretch text-center">
          <h2 className="text-base font-semibold mb-3" style={{ color: "var(--color-heading)" }}>
            Manage
          </h2>
          <Link
            href="/business-hub/manage"
            prefetch={false}
            className="inline-flex items-center justify-center gap-2 rounded-[10px] px-6 py-3 text-white font-semibold transition opacity-90 hover:opacity-100 w-full no-underline"
            style={{ backgroundColor: "var(--color-primary)" }}
          >
            <IonIcon name="folder-outline" size={28} className="text-white shrink-0" />
            Business Offers & Publicity
          </Link>
        </div>

        {businesses.length > 0 && activeBusiness && (
          <div className="mt-6 flex flex-col items-center text-center">
            <h2 className="text-base font-semibold mb-3" style={{ color: "var(--color-heading)" }}>
              QR Code
            </h2>
            <button
              type="button"
              onClick={() =>
                setQrPopupBusiness({
                  id: activeBusiness.id,
                  name: activeBusiness.name,
                  slug: activeBusiness.slug,
                })
              }
              className="inline-flex items-center justify-center gap-2 rounded-[10px] px-6 py-3 text-white font-semibold transition opacity-90 hover:opacity-100 mb-2 w-full max-w-md"
              style={{ backgroundColor: "var(--color-primary)" }}
            >
              <IonIcon name="qr-code" size={28} className="text-white" />
              Show My QR Code
            </button>
            <p className="text-sm text-gray-600 mb-4 max-w-md">
              Show this QR code to customers so they can scan it and earn reward points for supporting your
              business.
            </p>
            <h2 className="text-base font-semibold mb-3 mt-2" style={{ color: "var(--color-heading)" }}>
              Download
            </h2>
            <div className="grid grid-cols-2 gap-3 w-full max-w-md mx-auto">
              <a
                href={`/api/businesses/${activeBusiness.id}/qr`}
                download={`nwc-qr-${activeBusiness.slug ?? activeBusiness.id}.png`}
                className={mobileGridTile + " no-underline"}
                style={mobileGridTileStyle}
              >
                <IonIcon name="qr-code" size={28} className="text-[var(--color-primary)]" />
                <span
                  className="text-sm font-semibold text-center leading-tight"
                  style={{ color: "var(--color-heading)" }}
                >
                  QR Code
                </span>
              </a>
              <button
                type="button"
                onClick={() => handleDownloadFlyer(activeBusiness.id, activeBusiness.slug ?? activeBusiness.id)}
                disabled={flyerDownloading}
                className={mobileGridTile}
                style={mobileGridTileStyle}
                aria-busy={flyerDownloading}
              >
                {flyerDownloading ? (
                  <span className="text-sm text-gray-600">Preparing…</span>
                ) : (
                  <>
                    <IonIcon name="document-text" size={28} className="text-[var(--color-primary)]" />
                    <span
                      className="text-sm font-semibold text-center leading-tight"
                      style={{ color: "var(--color-heading)" }}
                    >
                      Download Flyer
                    </span>
                  </>
                )}
              </button>
            </div>
            <p className="text-sm text-gray-600 mt-3 max-w-md">
              Download the QR or print the Flyer and hang it up in your storefront.
            </p>
          </div>
        )}
      </div>

      {hubSwitcherOpen && businesses.length > 1 ? (
        <div
          className="fixed inset-0 z-[250] lg:hidden flex justify-center items-start pt-24 px-6 bg-black/40"
          role="dialog"
          aria-label="Choose business"
        >
          <button
            type="button"
            className="absolute inset-0 cursor-default"
            aria-label="Close"
            onClick={() => setHubSwitcherOpen(false)}
          />
          <div
            className="relative z-10 w-full max-w-sm rounded-lg border-2 overflow-hidden bg-white shadow-xl"
            style={{ borderColor: "var(--color-primary)" }}
          >
            {businesses.map((b, i) => (
              <button
                key={b.id}
                type="button"
                onClick={() => {
                  setActiveBusinessId(b.id);
                  setHubSwitcherOpen(false);
                }}
                className={
                  "w-full text-left px-5 py-3.5 text-base font-semibold transition " +
                  (i < businesses.length - 1 ? "border-b border-gray-200 " : "") +
                  (activeBusiness?.id === b.id ? "bg-[var(--color-section-alt)]" : "hover:bg-gray-50")
                }
                style={{ color: "var(--color-heading)" }}
              >
                {b.name}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="hidden lg:block">
        {sellerHubReturnButton}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <button
          type="button"
          onClick={openBusinessModal}
          title="Set up or edit up to 2 businesses"
          className={businessCardClass + " cursor-pointer text-left max-md:text-center border-0"}
        >
          <IonIcon name="business" size={28} className="text-[var(--color-primary)] mb-2" />
          <h2 className="text-xl font-bold mb-2">Set up / Edit Local Business Page</h2>
          <p className="text-sm text-gray-600">
            Submit or edit your business information for the Support Local directory.
          </p>
        </button>
        <button
          type="button"
          onClick={() => setOpenModal("coupon")}
          className={hubCardClass + " cursor-pointer text-left max-md:text-center"}
        >
          <IonIcon name="pricetag" size={28} className="text-[var(--color-primary)] mb-2" />
          <h2 className="text-xl font-bold mb-2">Offer a Coupon</h2>
          <p className="text-sm text-gray-600">
            Add a coupon to the coupon book. Include business name, discount, code, and optional QR/barcode.
          </p>
        </button>
        <button
          type="button"
          onClick={() => setOpenModal("reward")}
          className={hubCardClass + " cursor-pointer text-left max-md:text-center"}
        >
          <IonIcon name="gift" size={28} className="text-[var(--color-primary)] mb-2" />
          <h2 className="text-xl font-bold mb-2">Offer a Reward</h2>
          <p className="text-sm text-gray-600">
            Offer items, services, or major discounts to community members who collect the most points.
          </p>
        </button>
        <Link
          href="/business-hub/reward-redemptions"
          className={hubCardClass + " text-left max-md:text-center"}
        >
          <IonIcon name="cube-outline" size={28} className="text-[var(--color-primary)] mb-2" />
          <h2 className="text-xl font-bold mb-2">Redeemed Rewards</h2>
          <p className="text-sm text-gray-600">
            See who redeemed your rewards, contact info for shipped items, and links to fulfillment orders. Shipping is never charged to members for rewards.
          </p>
        </Link>
        <button
          type="button"
          onClick={() => setOpenModal("event")}
          className={hubCardClass + " cursor-pointer text-left max-md:text-center"}
        >
          <IonIcon name="calendar" size={28} className="text-[var(--color-primary)] mb-2" />
          <h2 className="text-xl font-bold mb-2">Post Event</h2>
          <p className="text-sm text-gray-600">
            Add an event to one of the six community calendars.
          </p>
        </button>
        {businesses.length > 0 && (
          <button
            type="button"
            onClick={() => {
              if (businesses.length === 1) {
                const biz = businesses[0];
                setCreatePostBusiness({ id: biz.id, name: biz.name });
                setCreatePostOpen(true);
              } else {
                setOpenModal("create-post-picker");
              }
            }}
            className={hubCardClass + " cursor-pointer text-left max-md:text-center"}
          >
            <IonIcon name="megaphone" size={28} className="text-[var(--color-primary)] mb-2" />
            <h2 className="text-xl font-bold mb-2">Create Post</h2>
            <p className="text-sm text-gray-600">
              Share an update from your business on the community feed (Business Post).
            </p>
          </button>
        )}
      </div>

      <div className="mb-8 flex flex-col items-stretch max-w-2xl mx-auto w-full text-center">
        <h2 className="text-lg font-semibold mb-3" style={{ color: "var(--color-heading)" }}>
          Manage
        </h2>
        <Link
          href="/business-hub/manage"
          className="inline-flex items-center justify-center gap-2 rounded-[10px] px-6 py-3 text-white font-semibold transition opacity-90 hover:opacity-100 mb-2 w-full no-underline"
          style={{ backgroundColor: "var(--color-primary)" }}
        >
          <IonIcon name="folder-outline" size={28} className="text-white shrink-0" />
          My Posts, Coupons, and Rewards
        </Link>
      </div>

      {businesses.length > 0 && (
        <div className="mb-8 flex flex-col items-center text-center">
          <h2 className="text-lg font-semibold mb-3" style={{ color: "var(--color-heading)" }}>
            QR Code
          </h2>
          {businesses.length === 1 ? (
            <button
              type="button"
              onClick={() => setQrPopupBusiness({ id: businesses[0].id, name: businesses[0].name, slug: businesses[0].slug })}
              className="inline-flex items-center justify-center gap-2 rounded-[10px] px-6 py-3 text-white font-semibold transition opacity-90 hover:opacity-100 mb-2"
              style={{ backgroundColor: "var(--color-primary)" }}
            >
              <IonIcon name="qr-code" size={28} className="text-white" />
              Show My QR Code
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setOpenModal("qr-picker")}
              className="inline-flex items-center justify-center gap-2 rounded-[10px] px-6 py-3 text-white font-semibold transition opacity-90 hover:opacity-100 mb-2"
              style={{ backgroundColor: "var(--color-primary)" }}
            >
              <IonIcon name="qr-code" size={28} className="text-white" />
              Show My QR Code
            </button>
          )}
          {businesses.length === 1 && (
            <p className="text-sm text-gray-600 mb-4 max-w-md">
              Show this QR code to customers so they can scan it and earn reward points for supporting your business.
            </p>
          )}
          <h2 className="text-lg font-semibold mb-3 mt-6" style={{ color: "var(--color-heading)" }}>
            Download
          </h2>
          <div className="flex flex-wrap justify-center gap-8 w-full max-w-2xl mx-auto">
            {businesses.length === 1 ? (
              <>
                <a
                  href={`/api/businesses/${businesses[0].id}/qr`}
                  download={`nwc-qr-${businesses[0].slug ?? businesses[0].id}.png`}
                  className={hubCardClass + " cursor-pointer no-underline shrink-0 basis-[min(100%,280px)]"}
                >
                  <IonIcon name="qr-code" size={28} className="text-[var(--color-primary)] mb-2" />
                  <h2 className="text-xl font-bold mb-2">QR Code</h2>
                  <p className="text-sm text-gray-600">Download your business QR code image.</p>
                </a>
                <button
                  type="button"
                  onClick={() => handleDownloadFlyer(businesses[0].id, businesses[0].slug ?? businesses[0].id)}
                  disabled={flyerDownloading}
                  className={hubCardClass + " cursor-pointer border-0 text-left max-md:text-center shrink-0 basis-[min(100%,280px)]"}
                  aria-busy={flyerDownloading}
                >
                  {flyerDownloading ? (
                    <span className="text-sm text-gray-600">Preparing…</span>
                  ) : (
                    <>
                      <IonIcon name="document-text" size={28} className="text-[var(--color-primary)] mb-2" />
                      <h2 className="text-xl font-bold mb-2">Download Flyer</h2>
                      <p className="text-sm text-gray-600">Download a printable flyer for your storefront.</p>
                    </>
                  )}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={openBusinessModal}
                  className={hubCardClass + " cursor-pointer border-0 text-left max-md:text-center shrink-0 basis-[min(100%,280px)]"}
                >
                  <IonIcon name="qr-code" size={28} className="text-[var(--color-primary)] mb-2" />
                  <h2 className="text-xl font-bold mb-2">QR Code</h2>
                  <p className="text-sm text-gray-600">Manage businesses to access QR and flyer downloads.</p>
                </button>
                <button
                  type="button"
                  onClick={openBusinessModal}
                  className={hubCardClass + " cursor-pointer border-0 text-left max-md:text-center shrink-0 basis-[min(100%,280px)]"}
                >
                  <IonIcon name="document-text" size={28} className="text-[var(--color-primary)] mb-2" />
                  <h2 className="text-xl font-bold mb-2">Download Flyer</h2>
                  <p className="text-sm text-gray-600">Manage businesses to access flyer download.</p>
                </button>
              </>
            )}
          </div>
          {businesses.length === 1 && (
            <p className="text-sm text-gray-600 mt-3 max-w-md">
              Download the QR or print the Flyer and hang it up in your storefront.
            </p>
          )}
        </div>
      )}

      {isSeller && (
        <div
          className="p-4 rounded-lg border-2 mt-4"
          style={{ backgroundColor: "var(--color-section-alt)", borderColor: "var(--color-primary)" }}
        >
          <p className="text-sm mb-2" style={{ color: "var(--color-primary)" }}>
            You&apos;re on the Seller plan. Access storefront and orders in Seller Hub.
          </p>
          <Link href="/seller-hub" className="btn text-sm">
            Go to Seller Hub
          </Link>
        </div>
      )}
      </div>

      <CreatePostModal
        open={createPostOpen}
        onClose={() => { setCreatePostOpen(false); setCreatePostBusiness(null); }}
        sharedBusinessId={createPostBusiness?.id}
        sharedBusinessName={createPostBusiness?.name}
      />

      {openModal === "coupon" && (
        <Modal title="Offer a Coupon" onClose={closeModal}>
          {isSeller && (
            <p className="mb-4 p-3 rounded-lg text-sm border border-amber-200 bg-amber-50 text-amber-900">
              Coupons are currently not enabled for our online storefront, a feature that will be implemented soon. These coupons are for physical in-person shopping.
            </p>
          )}
          <CouponForm businesses={businesses} onSuccess={closeModal} />
        </Modal>
      )}
      {openModal === "event" && (
        <Modal title="Post Event" onClose={closeModal}>
          <EventForm onSuccess={closeModal} businesses={businesses} />
        </Modal>
      )}
      {openModal === "reward" && (
        <Modal title="Offer a Reward" onClose={closeModal}>
          {rewardShowingExplanation ? (
            <div className="space-y-6">
              <p className="text-gray-600">
                Offer incentives for local residents in the area to choose local businesses. Reward the community members who are most actively supporting local.
              </p>
              <h3 className="text-lg font-semibold">How it works</h3>
              <p className="text-gray-600">
                Local businesses can offer prizes to community members who collect the most <strong>Community Points</strong> (tracked in the My Community page). Points are earned by supporting local—saving businesses, attending events, using coupons, and engaging with the community.
              </p>
              <h3 className="text-lg font-semibold">What you can offer</h3>
              <ul className="list-disc pl-6 space-y-2 text-gray-600">
                <li><strong>An item</strong> — A product or gift from your business</li>
                <li><strong>A service</strong> — A complimentary service or experience</li>
                <li><strong>A major discount</strong> — A significant discount for top point-earners</li>
              </ul>
              <p className="text-gray-600">
                Your reward goes to residents who are most actively supporting local businesses in the area. It&apos;s a great way to give back to your most engaged customers and encourage others to support local too.
              </p>
              <button
                type="button"
                onClick={() => setRewardShowingExplanation(false)}
                className="btn"
              >
                Back to form
              </button>
            </div>
          ) : (
            <div className="space-y-6">
              <div>
                <p className="text-gray-600 mb-1">
                  Create a reward that community members can redeem with their Community Points. Set the points required and how many times it can be redeemed before it&apos;s removed from the rewards page.
                </p>
                <button
                  type="button"
                  onClick={() => setRewardShowingExplanation(true)}
                  className="btn text-white hover:text-[var(--color-primary)] py-0.5"
                >
                  Offer a Reward? — How it works
                </button>
              </div>
              <RewardForm onSuccess={closeModal} />
            </div>
          )}
        </Modal>
      )}

      {openModal === "qr-picker" && (
        <Modal title="Show QR Code for" onClose={closeModal}>
          <div className="flex flex-col gap-3">
            {businesses.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => {
                  setQrPopupBusiness({ id: b.id, name: b.name, slug: b.slug });
                  setOpenModal(null);
                }}
                className="w-full flex items-center gap-3 p-4 rounded-xl border-2 border-[var(--color-primary)] text-left hover:bg-[var(--color-section-alt)]"
              >
                <IonIcon name="qr-code" size={28} className="text-[var(--color-primary)] shrink-0" />
                <span className="font-semibold">{b.name}</span>
              </button>
            ))}
          </div>
        </Modal>
      )}

      {openModal === "create-post-picker" && (
        <Modal title="Create Post as" onClose={closeModal}>
          <div className="flex flex-col gap-3">
            {businesses.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => {
                  setCreatePostBusiness({ id: b.id, name: b.name });
                  setOpenModal(null);
                  setCreatePostOpen(true);
                }}
                className="w-full flex items-center gap-3 p-4 rounded-xl border-2 border-[var(--color-primary)] text-left hover:bg-[var(--color-section-alt)]"
              >
                <IonIcon name="megaphone" size={28} className="text-[var(--color-primary)] shrink-0" />
                <span className="font-semibold">{b.name}</span>
              </button>
            ))}
          </div>
        </Modal>
      )}

      {qrPopupBusiness && (
        <QRCodePopup
          businessId={qrPopupBusiness.id}
          businessName={qrPopupBusiness.name}
          slug={qrPopupBusiness.slug}
          onClose={() => setQrPopupBusiness(null)}
        />
      )}

      {openModal === "business" && (
        <Modal
          title={
            businessView === "list"
              ? "Set up / Edit Local Business Page"
              : businessView === "add"
              ? "Add business"
              : "Edit business"
          }
          onClose={closeModal}
        >
          {businessView === "list" && (
            <div className="space-y-4">
              <p className="text-gray-600">
                You can have up to {MAX_BUSINESSES} businesses. Add or edit your business information for the Support Local directory.
              </p>
              <ul className="space-y-3">
                {businesses.map((b) => (
                  <li
                    key={b.id}
                    className="border-2 border-[var(--color-primary)] rounded-lg p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                  >
                    <h3 className="font-semibold text-lg" style={{ color: "var(--color-heading)" }}>
                      {b.name}
                    </h3>
                    <button
                      type="button"
                      onClick={() => handleEditBusiness(b.id)}
                      disabled={businessLoading}
                      className="btn text-sm shrink-0"
                    >
                      Edit
                    </button>
                  </li>
                ))}
              </ul>
              {businesses.length < MAX_BUSINESSES ? (
                <button
                  type="button"
                  onClick={() => setBusinessView("add")}
                  className="btn w-full sm:w-auto"
                >
                  Add business
                </button>
              ) : (
                <p className="text-gray-500 text-sm">Maximum {MAX_BUSINESSES} businesses. Edit an existing one above.</p>
              )}
            </div>
          )}
          {businessView === "add" && (
            <div className="space-y-4">
              <button
                type="button"
                onClick={() => setBusinessView("list")}
                className="text-sm text-gray-600 hover:underline"
              >
                ← Back to list
              </button>
              <BusinessForm onSuccess={handleBusinessSuccess} />
            </div>
          )}
          {businessView === "edit" && editingBusinessId && (
            <div className="space-y-4">
              <button
                type="button"
                onClick={() => {
                  setBusinessView("list");
                  setEditingBusinessId(null);
                  setEditingBusiness(null);
                }}
                className="text-sm text-gray-600 hover:underline"
              >
                ← Back to list
              </button>
              {businessLoading && !editingBusiness ? (
                <p className="text-gray-500">Loading…</p>
              ) : editingBusiness ? (
                <>
                  <BusinessForm
                    existing={
                      {
                        ...editingBusiness,
                        name: editingBusiness.name ?? "",
                        shortDescription: editingBusiness.shortDescription ?? null,
                        fullDescription: editingBusiness.fullDescription ?? null,
                        website: editingBusiness.website ?? null,
                        phone: editingBusiness.phone ?? null,
                        email: editingBusiness.email ?? null,
                        logoUrl: editingBusiness.logoUrl ?? null,
                        coverPhotoUrl: editingBusiness.coverPhotoUrl ?? null,
                        address: editingBusiness.address ?? null,
                        city: editingBusiness.city ?? "",
                        categories: editingBusiness.categories ?? [],
                        subcategoriesByPrimary: (editingBusiness as Business).subcategoriesByPrimary ?? {},
                        photos: editingBusiness.photos ?? [],
                        hoursOfOperation: editingBusiness.hoursOfOperation ?? null,
                      } as Pick<
                        Business,
                        | "id"
                        | "name"
                        | "shortDescription"
                        | "fullDescription"
                        | "website"
                        | "phone"
                        | "email"
                        | "logoUrl"
                        | "coverPhotoUrl"
                        | "address"
                        | "city"
                        | "categories"
                        | "subcategoriesByPrimary"
                        | "photos"
                        | "hoursOfOperation"
                      >
                    }
                    onSuccess={handleBusinessSuccess}
                  />
                  <DeleteBusinessButton
                    businessId={editingBusiness.id}
                    businessName={editingBusiness.name ?? "this business"}
                    onDeleted={handleBusinessDeleted}
                  />
                </>
              ) : null}
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
