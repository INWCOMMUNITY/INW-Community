"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useLockBodyScroll } from "@/lib/scroll-lock";
import { CreatePostForm } from "@/components/CreatePostForm";

export type EditFeedPostPayload = {
  id: string;
  content: string | null;
  photos: string[];
  videos?: string[];
  tags?: { id: string; name: string; slug: string }[];
  groupId?: string | null;
  type?: string;
  sourceBusiness?: { id: string; name: string } | null;
};

interface CreatePostModalProps {
  open: boolean;
  onClose: () => void;
  /** Pre-select this group (e.g. when opened from a group page). */
  groupId?: string;
  /** When set, post is created as a business post (e.g. when opened from Seller Hub). */
  sharedBusinessId?: string;
  /** Business name to show when posting as business. */
  sharedBusinessName?: string;
  /** When set and no sharedBusinessId, show this message instead of the form (e.g. "Set up your business to post from Seller Hub"). */
  noBusinessMessage?: string;
  /** Not used when onSuccess is used; kept for form internal use if needed. */
  returnTo?: string;
  /** When set, form updates this post instead of creating. */
  editPost?: EditFeedPostPayload | null;
  /** Optional hook after create/update succeeds (e.g. refetch client-side feed). Runs before onClose and router.refresh. */
  onAfterSuccess?: () => void;
}

const backdropClass =
  "fixed left-0 right-0 bottom-0 z-[110] flex items-center justify-center p-4 bg-black/50 overflow-y-auto";
const panelClass =
  "relative z-[1] isolate rounded-xl shadow-xl bg-white w-full max-w-2xl overflow-y-auto border-2 border-[var(--color-primary)]";

export function CreatePostModal({
  open,
  onClose,
  groupId,
  sharedBusinessId,
  sharedBusinessName,
  noBusinessMessage,
  returnTo,
  editPost,
  onAfterSuccess,
}: CreatePostModalProps) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useLockBodyScroll(open);

  function handleSuccess() {
    onAfterSuccess?.();
    onClose();
    router.refresh();
  }

  if (!open || !mounted) return null;

  const modal = (
    <div
      className={backdropClass}
      style={{ top: "var(--site-header-height, 5rem)" }}
      aria-modal="true"
      role="dialog"
      aria-labelledby="create-post-modal-title"
      onClick={onClose}
    >
      <div
        className={panelClass}
        style={{
          maxHeight:
            "min(90vh, calc(100dvh - var(--site-header-height, 5rem) - 2rem))",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 bg-white border-b px-6 py-4 flex items-center justify-between gap-4">
          <h2 id="create-post-modal-title" className="text-xl font-bold">
            {editPost ? "Edit post" : "Create Post"}
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
        <div className="p-6 bg-white">
          {noBusinessMessage && !sharedBusinessId && !editPost ? (
            <>
              <p className="text-gray-700 mb-4">{noBusinessMessage}</p>
              <Link
                href="/seller-hub/store"
                className="btn inline-block"
                onClick={() => onClose()}
              >
                Go to Seller Storefront
              </Link>
            </>
          ) : (
            <CreatePostForm
              key={editPost?.id ?? "create"}
              initialGroupId={editPost ? (editPost.groupId ?? "") : groupId}
              initialSharedBusinessId={
                editPost?.type === "shared_business" && editPost.sourceBusiness?.id
                  ? editPost.sourceBusiness.id
                  : sharedBusinessId
              }
              initialSharedBusinessName={
                editPost?.type === "shared_business" && editPost.sourceBusiness
                  ? editPost.sourceBusiness.name
                  : sharedBusinessName
              }
              returnTo={returnTo ?? "/my-community/feed"}
              onSuccess={handleSuccess}
              onCancel={onClose}
              editPostId={editPost?.id}
              initialContent={editPost?.content}
              initialPhotos={editPost?.photos}
              initialVideos={editPost?.videos}
              initialTags={editPost?.tags?.map((t) => t.name)}
            />
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
