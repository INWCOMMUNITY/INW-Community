"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useLockBodyScroll } from "@/lib/scroll-lock";
import { EventForm } from "@/components/EventForm";
import { CouponForm } from "@/components/CouponForm";
import { RewardForm } from "@/components/RewardForm";

interface BusinessOption {
  id: string;
  name: string;
}

interface SponsorHubCardsWithModalsProps {
  businesses: BusinessOption[];
}

type ModalType = "event" | "coupon" | "reward" | null;

export function SponsorHubCardsWithModals({ businesses }: SponsorHubCardsWithModalsProps) {
  const [openModal, setOpenModal] = useState<ModalType>(null);
  const router = useRouter();

  const handleSuccess = () => {
    setOpenModal(null);
    router.refresh();
  };

  useLockBodyScroll(!!openModal);

  const cardClass =
    "w-72 min-w-[240px] max-w-[320px] border-2 border-[var(--color-primary)] rounded-lg p-6 transition text-center hover:bg-[var(--color-section-alt)] cursor-pointer text-left max-md:text-center";

  const modalOverlayClass =
    "fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 overflow-hidden";
  const modalPanelClass =
    "bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-hidden flex flex-col";
  const modalHeaderClass =
    "flex items-center justify-between gap-4 p-4 border-b border-gray-200 shrink-0";
  const modalBodyClass = "p-4 overflow-y-auto flex-1 min-h-0";

  return (
    <>
      <div className="flex flex-wrap justify-center gap-8 mb-8 max-md:flex-col max-md:items-center">
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

      {openModal === "event" && (
        <div
          className={modalOverlayClass}
          aria-modal="true"
          role="dialog"
          aria-labelledby="modal-event-title"
          onClick={() => setOpenModal(null)}
        >
          <div className={modalPanelClass} onClick={(e) => e.stopPropagation()}>
            <div className={modalHeaderClass}>
              <h2 id="modal-event-title" className="text-xl font-bold">
                Post Event
              </h2>
              <button
                type="button"
                onClick={() => setOpenModal(null)}
                className="p-2 rounded-full hover:bg-gray-100 text-gray-600"
                aria-label="Close"
              >
                <span className="text-xl leading-none">×</span>
              </button>
            </div>
            <div className={modalBodyClass}>
              <EventForm onSuccess={handleSuccess} />
            </div>
          </div>
        </div>
      )}

      {openModal === "coupon" && (
        <div
          className={modalOverlayClass}
          aria-modal="true"
          role="dialog"
          aria-labelledby="modal-coupon-title"
          onClick={() => setOpenModal(null)}
        >
          <div className={modalPanelClass} onClick={(e) => e.stopPropagation()}>
            <div className={modalHeaderClass}>
              <h2 id="modal-coupon-title" className="text-xl font-bold">
                Offer a Coupon
              </h2>
              <button
                type="button"
                onClick={() => setOpenModal(null)}
                className="p-2 rounded-full hover:bg-gray-100 text-gray-600"
                aria-label="Close"
              >
                <span className="text-xl leading-none">×</span>
              </button>
            </div>
            <div className={modalBodyClass}>
              <CouponForm businesses={businesses} onSuccess={handleSuccess} />
            </div>
          </div>
        </div>
      )}

      {openModal === "reward" && (
        <div
          className={modalOverlayClass}
          aria-modal="true"
          role="dialog"
          aria-labelledby="modal-reward-title"
          onClick={() => setOpenModal(null)}
        >
          <div className={modalPanelClass} onClick={(e) => e.stopPropagation()}>
            <div className={modalHeaderClass}>
              <h2 id="modal-reward-title" className="text-xl font-bold">
                Offer a Reward
              </h2>
              <button
                type="button"
                onClick={() => setOpenModal(null)}
                className="p-2 rounded-full hover:bg-gray-100 text-gray-600"
                aria-label="Close"
              >
                <span className="text-xl leading-none">×</span>
              </button>
            </div>
            <div className={modalBodyClass}>
              <RewardForm onSuccess={handleSuccess} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
