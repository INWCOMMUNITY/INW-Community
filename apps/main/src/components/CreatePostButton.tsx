"use client";

import { useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { usePathname } from "next/navigation";
import { CreatePostModal } from "@/components/CreatePostModal";
import {
  PostAsIdentityPickerModal,
  type PostAsIdentityBusinessOption,
} from "@/components/PostAsIdentityPickerModal";

type Phase = "closed" | "picker" | "form";

interface CreatePostButtonProps {
  /** Pre-select this group when opening the form (e.g. from a group page). */
  groupId?: string;
  /** When posting into a group, whether the group allows business posts (avoids an extra fetch). */
  groupAllowsBusinessPosts?: boolean;
  /** Return path after posting (e.g. group page slug). */
  returnTo?: string;
  className?: string;
  children: React.ReactNode;
}

export function CreatePostButton({
  groupId,
  groupAllowsBusinessPosts,
  returnTo,
  className,
  children,
}: CreatePostButtonProps) {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const [phase, setPhase] = useState<Phase>("closed");
  const [pickerBusinesses, setPickerBusinesses] = useState<PostAsIdentityBusinessOption[]>([]);
  const [chosenBusiness, setChosenBusiness] = useState<PostAsIdentityBusinessOption | null>(null);

  const closeAll = useCallback(() => {
    setPhase("closed");
    setChosenBusiness(null);
    setPickerBusinesses([]);
  }, []);

  const openForm = useCallback((business: PostAsIdentityBusinessOption | null) => {
    setChosenBusiness(business);
    setPhase("form");
  }, []);

  const handleOpenClick = useCallback(async () => {
    if (status === "loading") return;
    if (!session?.user) {
      const callback = pathname || "/my-community/feed";
      window.location.href = `/login?callbackUrl=${encodeURIComponent(callback)}`;
      return;
    }

    let allowBizInGroup = groupAllowsBusinessPosts;
    if (groupId && allowBizInGroup === undefined) {
      try {
        const r = await fetch(`/api/groups/${groupId}`);
        const g = await r.json();
        allowBizInGroup = !!g.allowBusinessPosts;
      } catch {
        allowBizInGroup = false;
      }
    }

    const inGroup = Boolean(groupId);
    const mayOfferBusiness = !inGroup || allowBizInGroup;

    let list: PostAsIdentityBusinessOption[] = [];
    try {
      const r = await fetch("/api/businesses?mine=1");
      const data = await r.json();
      list = Array.isArray(data)
        ? data.map((b: { id: string; name: string }) => ({ id: b.id, name: b.name }))
        : [];
    } catch {
      list = [];
    }

    if (mayOfferBusiness && list.length > 0) {
      setPickerBusinesses(list);
      setChosenBusiness(null);
      setPhase("picker");
      return;
    }

    openForm(null);
  }, [groupId, groupAllowsBusinessPosts, openForm, pathname, session?.user, status]);

  const profileName = session?.user?.name?.trim() || "Your profile";

  return (
    <>
      <button type="button" onClick={() => void handleOpenClick()} className={className}>
        {children}
      </button>
      <PostAsIdentityPickerModal
        open={phase === "picker"}
        onClose={closeAll}
        profileDisplayName={profileName}
        businesses={pickerBusinesses}
        onSelectPersonal={() => openForm(null)}
        onSelectBusiness={(b) => openForm(b)}
      />
      <CreatePostModal
        open={phase === "form"}
        onClose={closeAll}
        groupId={groupId}
        returnTo={returnTo}
        sharedBusinessId={chosenBusiness?.id}
        sharedBusinessName={chosenBusiness?.name}
      />
    </>
  );
}
