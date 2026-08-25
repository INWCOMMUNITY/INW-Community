import { StyleSheet, View, Text, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { theme } from "@/lib/theme";
import { AppImage } from "@/components/AppImage";
import { buildProductPath, type ProductReferrer } from "@/lib/product-referrer";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

export interface StoreItemData {
  id: string;
  title: string;
  slug: string;
  photos: string[];
  category: string | null;
  secondaryCategory?: string | null;
  priceCents: number;
  quantity: number;
  shippingDisabled?: boolean;
  localDeliveryAvailable?: boolean;
  inStorePickupAvailable?: boolean;
  shippingCostCents?: number | null;
  business?: { name: string; slug: string; logoUrl?: string | null } | null;
}

interface StoreItemCardProps {
  item: StoreItemData;
  width: number;
  variant?: "grid" | "carousel";
  showBadges?: boolean;
  onQuickAdd?: (item: StoreItemData) => void;
  referrer?: ProductReferrer;
}

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function resolvePhotoUrl(path: string | undefined): string | undefined {
  if (!path) return undefined;
  return path.startsWith("http") ? path : `${siteBase}${path.startsWith("/") ? "" : "/"}${path}`;
}

export function StoreItemCard({
  item,
  width,
  variant = "grid",
  showBadges = true,
  onQuickAdd,
  referrer,
}: StoreItemCardProps) {
  const router = useRouter();
  const photoUrl = resolvePhotoUrl(item.photos?.[0]);
  const isCarousel = variant === "carousel";

  const hasFreeShipping =
    !item.shippingDisabled && item.shippingCostCents === 0;
  const hasLocalPickup = item.inStorePickupAvailable || item.localDeliveryAvailable;

  const openItem = () => {
    router.push(buildProductPath(item.slug, referrer ?? { type: "storefront" }) as never);
  };

  return (
    <Pressable
      style={({ pressed }) => [
        styles.card,
        { width },
        pressed && styles.cardPressed,
      ]}
      onPress={openItem}
    >
      <View style={[styles.cardImageWrap, isCarousel && styles.cardImageWrapCarousel]}>
        {photoUrl ? (
          <AppImage
            uri={photoUrl}
            targetWidth={width}
            quality={55}
            style={styles.cardImage}
            resizeMode="contain"
          />
        ) : (
          <View style={[styles.cardImage, styles.cardImagePlaceholder]}>
            <Ionicons name="image-outline" size={32} color={theme.colors.primary} />
          </View>
        )}

        {showBadges && (
          <>
            {hasFreeShipping && (
              <View style={[styles.badge, styles.badgeTopRight]}>
                <Text style={styles.badgeText}>Free Shipping</Text>
              </View>
            )}
            {hasLocalPickup && !hasFreeShipping && (
              <View style={[styles.badge, styles.badgeTopRight]}>
                <Text style={styles.badgeText}>Local Pickup</Text>
              </View>
            )}
            {item.business?.logoUrl && (
              <View style={styles.sellerBadge}>
                <AppImage
                  uri={resolvePhotoUrl(item.business.logoUrl) ?? ""}
                  targetWidth={28}
                  style={styles.sellerBadgeImage}
                  resizeMode="cover"
                />
              </View>
            )}
          </>
        )}

        {onQuickAdd && (
          <Pressable
            style={({ pressed }) => [
              styles.quickAddBtn,
              pressed && { opacity: 0.8 },
            ]}
            onPress={(e) => {
              e.stopPropagation?.();
              onQuickAdd(item);
            }}
          >
            <Ionicons name="add" size={18} color="#fff" />
          </Pressable>
        )}
      </View>

      <Text style={styles.cardTitle} numberOfLines={2}>
        {item.title}
      </Text>
      <Text style={styles.cardPrice}>{formatPrice(item.priceCents)}</Text>

      {(item.category || item.secondaryCategory) && (
        <View style={styles.categoryChipsRow}>
          {item.category && (
            <View
              style={[
                styles.categoryChip,
                item.secondaryCategory ? styles.categoryChipWhenPaired : null,
              ]}
            >
              <Text style={styles.categoryText} numberOfLines={1} ellipsizeMode="tail">
                {item.category}
              </Text>
            </View>
          )}
          {item.secondaryCategory && (
            <View
              style={[
                styles.categoryChip,
                item.category ? styles.categoryChipWhenPaired : null,
              ]}
            >
              <Text style={styles.categoryText} numberOfLines={1} ellipsizeMode="tail">
                {item.secondaryCategory}
              </Text>
            </View>
          )}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    overflow: "hidden",
    maxWidth: "100%",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  cardPressed: {
    opacity: 0.85,
  },
  cardImageWrap: {
    width: "100%",
    alignSelf: "stretch",
    aspectRatio: 4 / 5,
    backgroundColor: "#F8F8F3",
    overflow: "hidden",
    position: "relative",
    padding: 8,
  },
  cardImageWrapCarousel: {
    aspectRatio: 4 / 5,
  },
  cardImage: {
    width: "100%",
    height: "100%",
  },
  cardImagePlaceholder: {
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    position: "absolute",
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 4,
    backgroundColor: theme.colors.primary,
  },
  badgeTopRight: {
    top: 8,
    right: 8,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: "600",
    color: "#fff",
  },
  sellerBadge: {
    position: "absolute",
    bottom: 8,
    left: 8,
    width: 28,
    height: 28,
    borderRadius: 14,
    overflow: "hidden",
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.1)",
  },
  sellerBadgeImage: {
    width: "100%",
    height: "100%",
  },
  quickAddBtn: {
    position: "absolute",
    bottom: 8,
    right: 8,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: theme.colors.primary,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 2,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#000",
    padding: 8,
    paddingBottom: 4,
  },
  cardPrice: {
    fontSize: 16,
    fontWeight: "700",
    color: "#000",
    paddingHorizontal: 8,
    paddingBottom: 4,
  },
  categoryChipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    width: "100%",
    paddingHorizontal: 8,
    marginBottom: 8,
    alignItems: "center",
    alignSelf: "stretch",
  },
  categoryChip: {
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: theme.colors.creamAlt,
    maxWidth: "100%",
  },
  categoryChipWhenPaired: {
    flex: 1,
    minWidth: 0,
  },
  categoryText: {
    fontSize: 13,
    color: theme.colors.heading,
    flexShrink: 1,
  },
});
