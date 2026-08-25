"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useLockBodyScroll } from "@/lib/scroll-lock";
import Link from "next/link";
import { CouponForm } from "@/components/CouponForm";
import { EventForm } from "@/components/EventForm";
import { BusinessForm } from "@/components/BusinessForm";
import { DeleteBusinessButton } from "@/components/DeleteBusinessButton";
import { CreatePostModal } from "@/components/CreatePostModal";
import { IonIcon } from "@/components/IonIcon";
import {
  dismissProfileCompletion,
  isProfileCompletionDismissed,
  useBusinessCompletion,
} from "@/components/BusinessProfileCompletionCard";
import type { BusinessHubLiveCounts } from "@/lib/business-hub-live-counts";
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
  initialOpenModal?: "coupon" | "event" | null;
  liveCounts?: BusinessHubLiveCounts;
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
type OpenModal = null | "coupon" | "event" | "business" | "create-post-picker" | "flyer-picker";
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
  facebookUrl?: string | null;
  instagramUrl?: string | null;
  tiktokUrl?: string | null;
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

const actionTileClass =
  "flex flex-col items-start text-left gap-1 rounded-xl border p-3 md:p-4 transition hover:bg-[var(--color-section-alt)] w-full min-h-[5.25rem]";
const actionTileStyle = { borderColor: "var(--color-earth)" } as const;
const headerPillClass =
  "inline-flex items-center justify-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold no-underline hover:opacity-90 transition-opacity";
const headerPillStyle = { backgroundColor: "var(--color-earth)", color: "#fff" } as const;
const activePillClass =
  "mt-2 flex w-full items-center justify-center rounded-full px-2 py-2 text-center text-xs sm:text-sm font-semibold no-underline hover:opacity-90";
const activePillStyle = { backgroundColor: "var(--color-primary)", color: "#fff" } as const;

export function BusinessHubFormModals({
  businesses,
  isSeller,
  hasSellerHubAccess = false,
  sellerHubReturnInForm = false,
  initialOpenModal = null,
  liveCounts = { posts: 0, events: 0, coupons: 0 },
}: BusinessHubFormModalsProps) {
  const router = useRouter();
  const [openModal, setOpenModal] = useState<OpenModal>(null);
  const [flyerDownloading, setFlyerDownloading] = useState(false);
  const [businessView, setBusinessView] = useState<BusinessView>("list");
  const [editingBusinessId, setEditingBusinessId] = useState<string | null>(null);
  const [editingBusiness, setEditingBusiness] = useState<BusinessForForm | null>(null);
  const [businessLoading, setBusinessLoading] = useState(false);
  const [createPostOpen, setCreatePostOpen] = useState(false);
  const [createPostBusiness, setCreatePostBusiness] = useState<{ id: string; name: string } | null>(null);
  const [activeBusinessId, setActiveBusinessId] = useState<string | null>(null);
  const [hubSwitcherOpen, setHubSwitcherOpen] = useState(false);
  const [hubLogoLoadFailed, setHubLogoLoadFailed] = useState(false);

  const activeBusiness =
    businesses.find((b) => b.id === activeBusinessId) ?? businesses[0] ?? null;
  const hasBusiness = businesses.length > 0;
  const { percentage: completionPct, refresh: refreshCompletion } = useBusinessCompletion(
    activeBusiness?.id ?? null
  );
  const [completionDismissed, setCompletionDismissed] = useState(false);

  useEffect(() => {
    setActiveBusinessId((prev) => {
      if (businesses.length === 0) return null;
      if (prev && businesses.some((b) => b.id === prev)) return prev;
      return businesses[0]!.id;
    });
  }, [businesses]);

  useEffect(() => {
    const id = activeBusiness?.id;
    if (!id) {
      setCompletionDismissed(false);
      return;
    }
    setCompletionDismissed(isProfileCompletionDismissed(id));
  }, [activeBusiness?.id]);

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
    void refreshCompletion();
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

  function openCreatePost() {
    if (businesses.length === 1) {
      const biz = businesses[0]!;
      setCreatePostBusiness({ id: biz.id, name: biz.name });
      setCreatePostOpen(true);
      return;
    }
    setOpenModal("create-post-picker");
  }

  function startFlyerDownload() {
    if (!activeBusiness) return;
    if (businesses.length === 1) {
      void handleDownloadFlyer(activeBusiness.id, activeBusiness.slug ?? activeBusiness.id);
      return;
    }
    setOpenModal("flyer-picker");
  }

  useLockBodyScroll(!!openModal || createPostOpen || hubSwitcherOpen);

  const listingHref = activeBusiness?.slug
    ? `/support-local/${activeBusiness.slug}`
    : activeBusiness
      ? `/support-local/${activeBusiness.id}`
      : null;

  const hubTitleName =
    businesses.length === 0 ? "Your" : possessiveBusinessLine1(activeBusiness?.name ?? "");

  const rawLogo =
    hasBusiness && activeBusiness?.logoUrl?.trim() && !hubLogoLoadFailed
      ? activeBusiness.logoUrl.trim()
      : null;

  return (
    <>
      <div
        className="px-0 pt-0 pb-10"
        style={{ paddingBottom: "max(2.5rem, env(safe-area-inset-bottom))" }}
      >
        {sellerHubReturnInForm && (
          <Link
            href="/seller-hub"
            prefetch={false}
            className="mb-4 inline-flex items-center gap-2 text-sm font-semibold no-underline hover:underline"
            style={{ color: "var(--color-primary)" }}
          >
            <IonIcon name="arrow-back-outline" size={18} className="shrink-0" />
            Return to Seller Hub
          </Link>
        )}

        <div
          className="flex flex-row items-center gap-4 mb-4 py-4 px-4 rounded-xl border bg-white"
          style={{ borderColor: "var(--color-earth)" }}
        >
          <div className="shrink-0 flex justify-center items-center">
            <div
              className="flex items-center justify-center overflow-hidden border-2 rounded-full bg-white w-[7.5rem] h-[7.5rem] md:w-32 md:h-32"
              style={{ borderColor: "var(--color-primary)" }}
            >
              {rawLogo ? (
                <img
                  src={rawLogo}
                  alt={activeBusiness ? `${activeBusiness.name} logo` : "Business logo"}
                  className="w-full h-full object-contain"
                  onError={() => setHubLogoLoadFailed(true)}
                />
              ) : (
                <span
                  className="text-[28px] md:text-[34px] font-bold leading-none"
                  style={{ color: "var(--color-primary)", fontFamily: "var(--font-heading)" }}
                >
                  {activeBusiness != null ? businessLogoInitials(activeBusiness.name) : "?"}
                </span>
              )}
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <h1
              className="text-xl md:text-2xl font-bold mb-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5"
              style={{ fontFamily: "var(--font-heading)", color: "var(--color-heading)" }}
            >
              {businesses.length > 1 ? (
                <button
                  type="button"
                  onClick={() => setHubSwitcherOpen(true)}
                  className="inline-flex items-center gap-1"
                >
                  <span>{hubTitleName}</span>
                  <IonIcon name="chevron-down" size={20} className="text-[var(--color-primary)] shrink-0" />
                </button>
              ) : (
                <span>{hubTitleName}</span>
              )}
              <span>Business Hub</span>
            </h1>
            <p className="text-sm leading-5 mb-3" style={{ color: "var(--color-text)" }}>
              Update your business page, offer coupons, post events, and more!
            </p>
            {hasBusiness && (
              <div className="flex flex-col gap-2">
                {completionPct != null && completionPct < 100 && !completionDismissed && (
                  <>
                    <div className="flex items-center gap-2">
                      <div
                        className="h-2 flex-1 rounded-full overflow-hidden min-w-0"
                        style={{ backgroundColor: "#e5e7eb" }}
                        role="progressbar"
                        aria-valuenow={completionPct}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label="Business profile completeness"
                      >
                        <div
                          className="h-full rounded-full transition-all duration-300"
                          style={{
                            width: `${completionPct}%`,
                            backgroundColor: "var(--color-primary)",
                          }}
                        />
                      </div>
                      <span className="text-xs font-semibold shrink-0 tabular-nums" style={{ color: "var(--color-heading)" }}>
                        {completionPct}%
                      </span>
                    </div>
                    <p className="text-xs leading-4 text-gray-600">
                      Business profile completeness — add details so customers can get in touch.{" "}
                      <button
                        type="button"
                        onClick={() => {
                          const id = activeBusiness?.id;
                          if (!id) return;
                          dismissProfileCompletion([id]);
                          setCompletionDismissed(true);
                        }}
                        className="underline underline-offset-2 hover:text-gray-800"
                      >
                        Ignore
                      </button>
                    </p>
                  </>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={openBusinessModal}
                    className={headerPillClass}
                    style={headerPillStyle}
                  >
                    <IonIcon name="create-outline" size={16} className="text-white shrink-0" />
                    Edit Business Profile
                  </button>
                  {listingHref && (
                    <Link
                      href={listingHref}
                      prefetch={false}
                      className={headerPillClass}
                      style={headerPillStyle}
                    >
                      <IonIcon name="storefront-outline" size={16} className="text-white shrink-0" />
                      View Business Page
                    </Link>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {hasBusiness ? (
          <div className="grid grid-cols-3 gap-2 md:gap-3">
            <div className="min-w-0">
              <button
                type="button"
                onClick={openCreatePost}
                className={actionTileClass}
                style={actionTileStyle}
              >
                <IonIcon name="megaphone-outline" size={22} className="text-[var(--color-primary)]" />
                <span className="text-sm md:text-base font-semibold" style={{ color: "var(--color-heading)" }}>
                  Create Post
                </span>
                <span className="text-xs text-gray-600 hidden md:block">
                  Share an update on the community feed.
                </span>
              </button>
              <Link
                href="/business-hub/my-business-posts"
                prefetch={false}
                className={activePillClass}
                style={activePillStyle}
              >
                Active Posts
              </Link>
            </div>
            <div className="min-w-0">
              <button
                type="button"
                onClick={() => setOpenModal("coupon")}
                className={actionTileClass}
                style={actionTileStyle}
              >
                <IonIcon name="pricetag-outline" size={22} className="text-[var(--color-primary)]" />
                <span className="text-sm md:text-base font-semibold" style={{ color: "var(--color-heading)" }}>
                  Offer a Coupon
                </span>
                <span className="text-xs text-gray-600 hidden md:block">
                  Add a discount to the coupon book.
                </span>
              </button>
              <Link
                href="/business-hub/offered-coupons"
                prefetch={false}
                className={activePillClass}
                style={activePillStyle}
              >
                Active Coupons
              </Link>
            </div>
            <div className="min-w-0">
              <button
                type="button"
                onClick={() => setOpenModal("event")}
                className={actionTileClass}
                style={actionTileStyle}
              >
                <IonIcon name="calendar-outline" size={22} className="text-[var(--color-primary)]" />
                <span className="text-sm md:text-base font-semibold" style={{ color: "var(--color-heading)" }}>
                  Post Event
                </span>
                <span className="text-xs text-gray-600 hidden md:block">
                  Add an event to a community calendar.
                </span>
              </button>
              <Link
                href="/business-hub/my-business-events"
                prefetch={false}
                className={activePillClass}
                style={activePillStyle}
              >
                Active Events
              </Link>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={openBusinessModal}
            className={`${actionTileClass} max-w-xl`}
            style={actionTileStyle}
          >
            <IonIcon name="business-outline" size={24} className="text-[var(--color-primary)]" />
            <span className="text-base font-semibold" style={{ color: "var(--color-heading)" }}>
              Set up your listing
            </span>
            <span className="text-sm text-gray-600">
              Add your business to the Support Local directory to post, offer coupons, and list events.
            </span>
          </button>
        )}

        {hasBusiness && activeBusiness && (
          <div className="mt-8">
            <h2 className="text-base font-semibold mb-3" style={{ color: "var(--color-heading)" }}>
              Print
            </h2>
            <button
              type="button"
              onClick={startFlyerDownload}
              disabled={flyerDownloading}
              className={`${actionTileClass} max-w-md`}
              style={actionTileStyle}
              aria-busy={flyerDownloading}
            >
              {flyerDownloading ? (
                <span className="text-sm text-gray-600">Preparing…</span>
              ) : (
                <>
                  <IonIcon name="document-text-outline" size={24} className="text-[var(--color-primary)]" />
                  <span className="text-sm md:text-base font-semibold" style={{ color: "var(--color-heading)" }}>
                    Download Flyer
                  </span>
                  <span className="text-sm text-gray-600">
                    A printable page for your storefront.
                  </span>
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {hubSwitcherOpen && businesses.length > 1 ? (
        <div
          className="fixed inset-0 z-[250] flex justify-center items-start pt-24 px-6 bg-black/40"
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

      {openModal === "flyer-picker" && (
        <Modal title="Download Flyer for" onClose={closeModal}>
          <div className="flex flex-col gap-3">
            {businesses.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => {
                  setOpenModal(null);
                  void handleDownloadFlyer(b.id, b.slug ?? b.id);
                }}
                className="w-full flex items-center gap-3 p-4 rounded-xl border-2 border-[var(--color-primary)] text-left hover:bg-[var(--color-section-alt)]"
              >
                <IonIcon name="document-text-outline" size={28} className="text-[var(--color-primary)] shrink-0" />
                <span className="font-semibold">{b.name}</span>
              </button>
            ))}
          </div>
        </Modal>
      )}

      {openModal === "business" && (
        <Modal
          title={
            businessView === "list"
              ? "Set up / Edit Local Business Page"
              : businessView === "add"
              ? "Add Business"
              : "Edit Business"
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
                  Add Business
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
                        facebookUrl: editingBusiness.facebookUrl ?? null,
                        instagramUrl: editingBusiness.instagramUrl ?? null,
                        tiktokUrl: editingBusiness.tiktokUrl ?? null,
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
                        | "facebookUrl"
                        | "instagramUrl"
                        | "tiktokUrl"
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
