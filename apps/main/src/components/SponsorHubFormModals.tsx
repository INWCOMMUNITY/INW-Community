"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useLockBodyScroll } from "@/lib/scroll-lock";
import Link from "next/link";
import { CouponForm } from "@/components/CouponForm";
import { EventForm } from "@/components/EventForm";
import { RewardForm } from "@/components/RewardForm";

interface BusinessOption {
  id: string;
  name: string;
}

interface SponsorHubFormModalsProps {
  businesses: BusinessOption[];
  isSeller: boolean;
}

type OpenModal = null | "coupon" | "event" | "reward";

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
      aria-labelledby="sponsor-hub-modal-title"
      onClick={onClose}
    >
      <div
        className={modalPanelClass}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between gap-4 z-10">
          <h2 id="sponsor-hub-modal-title" className="text-xl font-bold">
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

export function SponsorHubFormModals({ businesses, isSeller }: SponsorHubFormModalsProps) {
  const router = useRouter();
  const [openModal, setOpenModal] = useState<OpenModal>(null);
  const [rewardShowingExplanation, setRewardShowingExplanation] = useState(false);

  const closeModal = () => {
    if (openModal === "reward") setRewardShowingExplanation(false);
    setOpenModal(null);
    router.refresh();
  };

  useLockBodyScroll(!!openModal);

  const cardClass =
    "border-2 border-[var(--color-primary)] rounded-lg p-6 transition text-center hover:bg-[var(--color-section-alt)] text-left cursor-pointer max-md:text-center min-w-0";
  const businessCardClass =
    "border-2 rounded-lg p-6 transition text-center hover:bg-[var(--color-section-alt)] border-[var(--color-secondary)] bg-[var(--color-secondary)]/5 min-w-0";

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 mb-8 max-md:grid-cols-1 max-md:place-items-center">
        <Link
          href="/sponsor-hub/business"
          title="Set up or edit up to 2 businesses"
          className={businessCardClass}
        >
          <h2 className="text-xl font-bold mb-2">Set up / Edit Local Business Page</h2>
          <p className="text-sm text-gray-600">
            Submit or edit your business information for the Support Local directory.
          </p>
        </Link>
        <button
          type="button"
          onClick={() => setOpenModal("coupon")}
          className={cardClass}
        >
          <h2 className="text-xl font-bold mb-2">Offer a Coupon</h2>
          <p className="text-sm text-gray-600">
            Add a coupon to the coupon book. Include business name, discount, code, and optional QR/barcode.
          </p>
        </button>
        <button
          type="button"
          onClick={() => setOpenModal("reward")}
          className={cardClass}
        >
          <h2 className="text-xl font-bold mb-2">Offer a Reward</h2>
          <p className="text-sm text-gray-600">
            Offer items, services, or major discounts to community members who collect the most points.
          </p>
        </button>
        <button
          type="button"
          onClick={() => setOpenModal("event")}
          className={cardClass}
        >
          <h2 className="text-xl font-bold mb-2">Post Event</h2>
          <p className="text-sm text-gray-600">
            Add an event to one of the six community calendars.
          </p>
        </button>
      </div>

      {openModal === "coupon" && (
        <Modal title="Offer a Coupon" onClose={closeModal}>
          <CouponForm businesses={businesses} onSuccess={closeModal} />
        </Modal>
      )}
      {openModal === "event" && (
        <Modal title="Post Event" onClose={closeModal}>
          <EventForm onSuccess={closeModal} />
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

      {isSeller && (
        <div
          className="p-4 rounded-lg border-2"
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
    </>
  );
}
