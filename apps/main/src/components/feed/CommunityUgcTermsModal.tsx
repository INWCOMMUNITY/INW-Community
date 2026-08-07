"use client";

import Link from "next/link";
import { IonIcon } from "@/components/IonIcon";
import { useLockBodyScroll } from "@/lib/scroll-lock";

type Props = {
  open: boolean;
  onAccept: () => void;
};

export function CommunityUgcTermsModal({ open, onAccept }: Props) {
  useLockBodyScroll(open);
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/50 p-4">
      <div
        className="max-w-lg w-full max-h-[90vh] overflow-y-auto rounded-xl bg-white shadow-xl p-6"
        role="dialog"
        aria-labelledby="ugc-terms-title"
      >
        <div className="flex flex-col items-center text-center">
          <IonIcon name="people-circle-outline" size={48} className="text-[var(--color-primary)] mb-4" />
          <h2 id="ugc-terms-title" className="text-xl font-bold text-[var(--color-heading)]">
            Before you join the community
          </h2>
          <p className="text-gray-600 mt-4 text-sm leading-relaxed">
            The Community feed includes photos, text, and listings shared by members. This content is
            user-generated. We moderate reports and expect everyone to follow our Terms of Service.
          </p>
          <p className="text-gray-600 mt-3 text-sm leading-relaxed">
            You can report posts that break the rules. Signed-in members can also block someone—blocked
            members disappear from your feed right away and we are notified to review.
          </p>
          <div className="flex flex-col gap-2 mt-5 w-full">
            <Link
              href="/terms"
              target="_blank"
              className="inline-flex items-center justify-center gap-2 text-sm font-medium text-[var(--color-primary)] hover:underline"
            >
              Read Terms of Service
              <IonIcon name="open-outline" size={16} />
            </Link>
            <Link
              href="/privacy"
              target="_blank"
              className="inline-flex items-center justify-center gap-2 text-sm font-medium text-[var(--color-primary)] hover:underline"
            >
              Privacy Policy
              <IonIcon name="open-outline" size={16} />
            </Link>
          </div>
          <button
            type="button"
            onClick={onAccept}
            className="mt-6 w-full rounded-lg py-3 text-base font-semibold text-white bg-[var(--color-primary)] hover:opacity-90"
          >
            I agree — continue to Community
          </button>
        </div>
      </div>
    </div>
  );
}
