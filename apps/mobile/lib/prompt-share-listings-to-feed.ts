import { Alert } from "react-native";

type ShareListingsOpener = (storeItemIds: string[]) => void;

let shareListingsOpener: ShareListingsOpener | null = null;

/** Register the global create-post share opener (set from CreatePostProvider host). */
export function setShareListingsToFeedOpener(opener: ShareListingsOpener | null): void {
  shareListingsOpener = opener;
}

/** Keep in sync with LISTING_FEED_COLLECTION_MIN in apps/main. */
const COLLECTION_MIN = 3;

/** Opens the feed composer for listing shares when available; falls back to a confirm alert. */
export function promptShareListingsToFeed(storeItemIds: string[]): void {
  const ids = storeItemIds.filter(Boolean);
  if (ids.length === 0) return;

  if (shareListingsOpener) {
    shareListingsOpener(ids);
    return;
  }

  const title =
    ids.length >= COLLECTION_MIN
      ? "Share collection on community feed?"
      : ids.length === 1
        ? "Share your item on the Community Feed?"
        : "Share your items on the Community Feed?";
  const message =
    ids.length >= COLLECTION_MIN
      ? "This import will appear as one collection on the Community Feed instead of a post for every listing."
      : ids.length === 1
        ? "Neighbors who follow you will see this listing in the feed."
        : "Each listing will appear as its own post on the Community Feed.";
  Alert.alert(title, message, [
    { text: "Not now", style: "cancel" },
    {
      text: "Share",
      onPress: () => {
        Alert.alert(
          "Share to feed",
          "Open Community and use Create Post, or try again after the app finishes loading."
        );
      },
    },
  ]);
}
