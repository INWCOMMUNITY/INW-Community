"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useLockBodyScroll } from "@/lib/scroll-lock";
import { EventForm } from "@/components/EventForm";

interface PostEventModalProps {
  calendarType: string;
  calendarLabel: string;
}

export function PostEventModal({ calendarType, calendarLabel }: PostEventModalProps) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { data: session, status } = useSession();

  useLockBodyScroll(open);

  const handleSuccess = () => {
    setOpen(false);
    router.refresh();
  };

  const triggerButton =
    status === "loading" ? (
      <span className="btn inline-block opacity-70 cursor-wait">
        Post Event
      </span>
    ) : !session?.user ? (
      <Link
        href={`/login?callbackUrl=${encodeURIComponent(`/calendars/${calendarType}`)}`}
        className="btn inline-block"
      >
        Post Event
      </Link>
    ) : (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn inline-block"
      >
        Post Event
      </button>
    );

  const modalContent = open ? (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/50 overflow-hidden"
      aria-modal="true"
      role="dialog"
      aria-labelledby="post-event-modal-title"
      onClick={() => setOpen(false)}
    >
      <div
        className="relative rounded-xl shadow-xl bg-white w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col border-2"
        style={{ borderColor: "var(--color-primary)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between gap-4 z-10 shrink-0">
          <h2 id="post-event-modal-title" className="text-xl font-bold">
            Post Event On {calendarLabel}
          </h2>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="w-8 h-8 rounded-full flex items-center justify-center text-gray-600 hover:bg-gray-100"
            aria-label="Close"
          >
            <span className="text-xl leading-none">×</span>
          </button>
        </div>
        <div className="p-6 overflow-y-auto flex-1 min-h-0">
          <EventForm
            initialCalendarType={calendarType}
            hideCalendarSelect
            onSuccess={handleSuccess}
          />
        </div>
      </div>
    </div>
  ) : null;

  return (
    <>
      <div className="max-md:w-full max-md:flex max-md:justify-center max-md:items-center">
        {triggerButton}
      </div>
      {open && typeof document !== "undefined"
        ? createPortal(modalContent, document.body)
        : modalContent}
    </>
  );
}
