import { Alert } from "react-native";
import { apiPost } from "@/lib/api";

/** Keep in sync with LISTING_FEED_COLLECTION_MIN in apps/main. */
const COLLECTION_MIN = 3;

export function promptShareListingsToFeed(storeItemIds: string[]): void {
  const ids = storeItemIds.filter(Boolean);
  if (ids.length === 0) return;
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
        void apiPost("/api/store-items/share-to-feed", { storeItemIds: ids }).catch(() => {
          Alert.alert("Could not share", "Try again from the listing later.");
        });
      },
    },
  ]);
}
