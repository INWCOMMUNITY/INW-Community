"use client";

import { useState } from "react";
import { CreatePostModal } from "@/components/CreatePostModal";

interface CreatePostButtonProps {
  /** Pre-select this group when opening the form (e.g. from a group page). */
  groupId?: string;
  /** Return path after posting (e.g. group page slug). */
  returnTo?: string;
  className?: string;
  children: React.ReactNode;
}

export function CreatePostButton({ groupId, returnTo, className, children }: CreatePostButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={className}
      >
        {children}
      </button>
      <CreatePostModal
        open={open}
        onClose={() => setOpen(false)}
        groupId={groupId}
        returnTo={returnTo}
      />
    </>
  );
}
