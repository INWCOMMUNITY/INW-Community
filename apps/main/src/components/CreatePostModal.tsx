"use client";

import { useRouter } from "next/navigation";
import { useLockBodyScroll } from "@/lib/scroll-lock";
import { CreatePostForm } from "@/components/CreatePostForm";

interface CreatePostModalProps {
  open: boolean;
  onClose: () => void;
  /** Pre-select this group (e.g. when opened from a group page). */
  groupId?: string;
  /** Not used when onSuccess is used; kept for form internal use if needed. */
  returnTo?: string;
}

const backdropClass =
  "fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/50 overflow-hidden";
const panelClass =
  "relative rounded-xl shadow-xl bg-white w-full max-w-2xl max-h-[90vh] overflow-y-auto border-2 border-[var(--color-primary)]";

export function CreatePostModal({ open, onClose, groupId, returnTo }: CreatePostModalProps) {
  const router = useRouter();

  useLockBodyScroll(open);

  if (!open) return null;

  function handleSuccess() {
    onClose();
    router.refresh();
  }

  return (
    <div
      className={backdropClass}
      aria-modal="true"
      role="dialog"
      aria-labelledby="create-post-modal-title"
      onClick={onClose}
    >
      <div className={panelClass} onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between gap-4 z-10">
          <h2 id="create-post-modal-title" className="text-xl font-bold">
            Create post
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
        <div className="p-6">
          <CreatePostForm
            initialGroupId={groupId}
            returnTo={returnTo ?? "/my-community"}
            onSuccess={handleSuccess}
            onCancel={onClose}
          />
        </div>
      </div>
    </div>
  );
}
