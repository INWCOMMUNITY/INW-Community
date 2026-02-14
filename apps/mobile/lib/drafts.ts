/**
 * Store item drafts - saved locally via AsyncStorage.
 * Drafts are form state that can be resumed later.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

const DRAFTS_KEY = "nwc_store_item_drafts";

export interface StoreItemDraft {
  id: string;
  title: string;
  description: string;
  photos: string[];
  category: string;
  priceCents: string;
  quantity: string;
  listingType: "new" | "resale";
  shippingDisabled: boolean;
  shippingCostDollars: string;
  shippingFree: boolean;
  shippingPolicy: string;
  useSellerProfileShipping: boolean;
  localDeliveryAvailable: boolean;
  localDeliveryFeeDollars: string;
  localDeliveryTerms: string;
  useSellerProfileLocalDelivery?: boolean;
  inStorePickupAvailable: boolean;
  pickupTerms?: string;
  useSellerProfilePickup?: boolean;
  businessId: string | null;
  variants: { name: string; options: string[] }[];
  savedAt: string;
}

export async function getDrafts(): Promise<StoreItemDraft[]> {
  try {
    const raw = await AsyncStorage.getItem(DRAFTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveDraft(draft: Omit<StoreItemDraft, "id" | "savedAt">): Promise<StoreItemDraft> {
  const full: StoreItemDraft = {
    ...draft,
    id: `draft-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    savedAt: new Date().toISOString(),
  };
  const drafts = await getDrafts();
  drafts.unshift(full);
  await AsyncStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
  return full;
}

export async function deleteDraft(id: string): Promise<void> {
  const drafts = await getDrafts();
  const filtered = drafts.filter((d) => d.id !== id);
  await AsyncStorage.setItem(DRAFTS_KEY, JSON.stringify(filtered));
}

export async function getDraft(id: string): Promise<StoreItemDraft | null> {
  const drafts = await getDrafts();
  return drafts.find((d) => d.id === id) ?? null;
}
