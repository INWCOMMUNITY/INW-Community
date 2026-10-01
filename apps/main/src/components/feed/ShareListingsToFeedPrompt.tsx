"use client";

import { CreatePostModal } from "@/components/CreatePostModal";
import { LISTING_FEED_COLLECTION_MIN } from "@/lib/listing-feed-collection-constants";

type ShareListingsToFeedPromptProps = {
  open: boolean;
  storeItemIds: string[];
  onClose: () => void;
  onSuccess?: () => void;
};

export function shareFeedPromptCopy(count: number): { title: string; body: string } {
  if (count >= LISTING_FEED_COLLECTION_MIN) {
    return {
      title: "Share collection on community feed?",
      body: "This import will appear as one collection on the Community Feed instead of a post for every listing.",
    };
  }
  if (count === 1) {
    return {
      title: "Share your item on the Community Feed?",
      body: "Neighbors who follow you will see this listing in the feed.",
    };
  }
  return {
    title: "Share your items on the Community Feed?",
    body: "Each listing will appear as its own post on the Community Feed.",
  };
}

/** Opens the full feed composer so sellers can caption/tag before sharing listings. */
export function ShareListingsToFeedPrompt({
  open,
  storeItemIds,
  onClose,
  onSuccess,
}: ShareListingsToFeedPromptProps) {
  const ids = storeItemIds.filter(Boolean);
  return (
    <CreatePostModal
      open={open && ids.length > 0}
      onClose={onClose}
      sharedStoreItemIds={ids}
      onAfterSuccess={onSuccess}
      returnTo="/my-community/feed"
    />
  );
}
