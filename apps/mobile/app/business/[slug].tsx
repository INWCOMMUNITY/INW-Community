import { useEffect, useState, useCallback } from "react";
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  Image,
  Pressable,
  ActivityIndicator,
  useWindowDimensions,
  Linking,
  Platform,
  Modal,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet, apiPost, apiDelete, getToken } from "@/lib/api";
import { CouponPopup } from "@/components/CouponPopup";
import { ShareToChatModal } from "@/components/ShareToChatModal";
import { useAuth } from "@/contexts/AuthContext";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

interface Coupon {
  id: string;
  name: string;
  discount: string;
  code: string;
}

interface Business {
  id: string;
  name: string;
  slug: string;
  shortDescription: string | null;
  fullDescription: string | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  logoUrl: string | null;
  address: string | null;
  city: string | null;
  categories: string[];
  hoursOfOperation: Record<string, string> | null;
  photos: string[];
  coupons: Coupon[];
}

function resolveUrl(path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  return path.startsWith("http") ? path : `${siteBase}${path.startsWith("/") ? "" : "/"}${path}`;
}

const DAY_ORDER = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

export default function BusinessScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const { width } = useWindowDimensions();

  const [business, setBusiness] = useState<Business | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [couponPopupId, setCouponPopupId] = useState<string | null>(null);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showSavedNote, setShowSavedNote] = useState(false);
  const { member } = useAuth();

  const load = useCallback(async () => {
    if (!slug) return;
    setLoading(true);
    setError("");
    try {
      const data = await apiGet<Business>(`/api/businesses?slug=${encodeURIComponent(slug)}`);
      setBusiness(data);
    } catch {
      setError("Business not found");
      setBusiness(null);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!member || !business) return;
    apiGet<{ type: string; referenceId: string }[]>(`/api/saved?type=business`)
      .then((items) => setSaved(items.some((i) => i.referenceId === business.id)))
      .catch(() => setSaved(false));
  }, [member, business?.id]);

  useEffect(() => {
    if (!showSavedNote) return;
    const timer = setTimeout(() => setShowSavedNote(false), 3000);
    return () => clearTimeout(timer);
  }, [showSavedNote]);

  const handleSaveToggle = async () => {
    if (!member || !business) return;
    const token = await getToken();
    if (!token) {
      router.push("/(auth)/login");
      return;
    }
    setSaving(true);
    try {
      if (saved) {
        await apiDelete(`/api/saved?type=business&referenceId=${encodeURIComponent(business.id)}`);
        setSaved(false);
      } else {
        await apiPost("/api/saved", { type: "business", referenceId: business.id });
        setSaved(true);
        setShowSavedNote(true);
      }
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  };

  const addressDisplay = business
    ? [business.address, business.city].filter(Boolean).join(", ")
    : "";
  const mapsUrl = addressDisplay
    ? Platform.OS === "ios"
      ? `https://maps.apple.com/?q=${encodeURIComponent(addressDisplay)}`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addressDisplay)}`
    : null;

  const hours = business?.hoursOfOperation;
  const hasHours = hours && typeof hours === "object" && Object.keys(hours).length > 0;

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  if (error || !business) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={24} color="#fff" />
          </Pressable>
          <View style={styles.headerTitleWrap}>
            <Text style={styles.headerTitleCentered}>{error || "Business not found"}</Text>
          </View>
        </View>
      </View>
    );
  }

  const logoUrl = resolveUrl(business.logoUrl);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </Pressable>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitleCentered} numberOfLines={1}>
            {business.name}
          </Text>
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {member && (
          <View style={styles.topActions}>
            <Pressable
              onPress={handleSaveToggle}
              disabled={saving}
              style={({ pressed }) => [styles.topActionBtn, pressed && { opacity: 0.8 }]}
            >
              <Ionicons
                name={saved ? "heart" : "heart-outline"}
                size={26}
                color={theme.colors.primary}
              />
            </Pressable>
            <Pressable
              onPress={() => setShareModalOpen(true)}
              style={({ pressed }) => [styles.topActionBtn, pressed && { opacity: 0.8 }]}
            >
              <Ionicons name="share-outline" size={26} color={theme.colors.primary} />
            </Pressable>
          </View>
        )}
        <View style={styles.hero}>
          <Text style={styles.name}>{business.name}</Text>
          {addressDisplay ? (
            <Pressable
              style={styles.addressRow}
              onPress={() => mapsUrl && Linking.openURL(mapsUrl)}
            >
              <Ionicons name="location" size={18} color={theme.colors.primary} />
              <Text style={styles.addressText} numberOfLines={2}>{addressDisplay}</Text>
              <Ionicons name="open-outline" size={14} color={theme.colors.primary} />
            </Pressable>
          ) : null}
        </View>

        <View style={styles.logoSection}>
          {logoUrl ? (
            <Image source={{ uri: logoUrl }} style={styles.logo} />
          ) : (
            <View style={[styles.logo, styles.logoPlaceholder]}>
              <Ionicons name="business" size={48} color={theme.colors.primary} />
            </View>
          )}
        </View>

        {hasHours && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Hours of Operation</Text>
            {DAY_ORDER.map((day) => {
              const val = hours?.[day];
              if (!val) return null;
              return (
                <View key={day} style={styles.hoursRow}>
                  <Text style={styles.hoursDay}>{day.charAt(0).toUpperCase() + day.slice(1)}</Text>
                  <Text style={styles.hoursVal}>{val}</Text>
                </View>
              );
            })}
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Contact</Text>
          {business.phone ? (
            <Pressable
              style={styles.contactRow}
              onPress={() => Linking.openURL(`tel:${business.phone}`)}
            >
              <Ionicons name="call" size={18} color={theme.colors.primary} />
              <Text style={styles.contactText}>{business.phone}</Text>
            </Pressable>
          ) : null}
          {business.email ? (
            <Pressable
              style={styles.contactRow}
              onPress={() => Linking.openURL(`mailto:${business.email}`)}
            >
              <Ionicons name="mail" size={18} color={theme.colors.primary} />
              <Text style={styles.contactText}>{business.email}</Text>
            </Pressable>
          ) : null}
          {business.website ? (
            <Pressable
              style={styles.contactRow}
              onPress={() => Linking.openURL(business.website!)}
            >
              <Ionicons name="globe" size={18} color={theme.colors.primary} />
              <Text style={styles.contactText}>{business.website}</Text>
            </Pressable>
          ) : null}
        </View>

        {addressDisplay && mapsUrl && (
          <Pressable style={styles.mapBtn} onPress={() => Linking.openURL(mapsUrl)}>
            <Ionicons name="map" size={20} color="#fff" />
            <Text style={styles.mapBtnText}>Open in Maps</Text>
          </Pressable>
        )}

        {business.shortDescription ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>About</Text>
            <Text style={styles.description}>{business.shortDescription}</Text>
          </View>
        ) : null}

        {business.fullDescription ? (
          <View style={styles.section}>
            <Text style={styles.description}>{business.fullDescription}</Text>
          </View>
        ) : null}

        {business.photos && business.photos.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Gallery</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.gallery}>
              {business.photos.map((p, i) => {
                const url = resolveUrl(p);
                if (!url) return null;
                return (
                  <Image
                    key={i}
                    source={{ uri: url }}
                    style={[styles.galleryImage, { width: width - 48 }]}
                    resizeMode="cover"
                  />
                );
              })}
            </ScrollView>
          </View>
        )}

        {business.coupons && business.coupons.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Coupons</Text>
            {business.coupons.map((c) => (
              <Pressable
                key={c.id}
                style={({ pressed }) => [styles.couponCard, pressed && { opacity: 0.8 }]}
                onPress={() => setCouponPopupId(c.id)}
              >
                <Text style={styles.couponName}>{c.name}</Text>
                <Text style={styles.couponDiscount}>{c.discount}</Text>
              </Pressable>
            ))}
          </View>
        )}

      </ScrollView>

      <Modal visible={showSavedNote} transparent animationType="fade">
        <Pressable style={styles.savedNoteBackdrop} onPress={() => setShowSavedNote(false)}>
          <Pressable style={styles.savedNoteBox} onPress={() => {}}>
            <Text style={styles.savedNoteText}>{business.name} Saved to My Businesses!</Text>
          </Pressable>
        </Pressable>
      </Modal>

      {couponPopupId && (
        <CouponPopup
          couponId={couponPopupId}
          onClose={() => setCouponPopupId(null)}
        />
      )}
      <ShareToChatModal
        visible={shareModalOpen}
        onClose={() => setShareModalOpen(false)}
        sharedContent={{ type: "business", id: business.id, slug: business.slug }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 12,
    paddingTop: 48,
    backgroundColor: theme.colors.primary,
    gap: 12,
  },
  backBtn: {
    padding: 4,
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: "600",
    color: "#fff",
  },
  headerTitleWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 48,
    bottom: 12,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 48,
  },
  headerTitleCentered: {
    fontSize: 18,
    fontWeight: "600",
    color: "#fff",
    textAlign: "center",
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 48,
  },
  topActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 0,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  topActionBtn: {
    paddingVertical: 10,
    paddingHorizontal: 4,
  },
  hero: {
    padding: 16,
    alignItems: "center",
  },
  name: {
    fontSize: 24,
    fontWeight: "700",
    color: theme.colors.heading,
    textAlign: "center",
  },
  addressRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 8,
  },
  addressText: {
    fontSize: 14,
    color: theme.colors.text,
    textAlign: "center",
  },
  logoSection: {
    alignItems: "center",
    paddingVertical: 16,
  },
  logo: {
    width: 220,
    height: 220,
    borderRadius: 12,
    backgroundColor: "#f5f5f5",
  },
  logoPlaceholder: {
    alignItems: "center",
    justifyContent: "center",
  },
  section: {
    paddingHorizontal: 16,
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: theme.colors.heading,
    marginBottom: 12,
  },
  hoursRow: {
    flexDirection: "row",
    marginBottom: 4,
  },
  hoursDay: {
    width: 90,
    fontSize: 14,
    color: theme.colors.text,
  },
  hoursVal: {
    fontSize: 14,
    color: theme.colors.text,
  },
  contactRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  contactText: {
    fontSize: 16,
    color: theme.colors.primary,
  },
  mapBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 24,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: theme.colors.primary,
    borderWidth: 2,
    borderColor: "#000",
  },
  mapBtnText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
  },
  description: {
    fontSize: 15,
    color: theme.colors.text,
    lineHeight: 22,
  },
  gallery: {
    marginHorizontal: -16,
  },
  galleryImage: {
    height: 200,
    borderRadius: 8,
    marginHorizontal: 16,
  },
  couponCard: {
    padding: 16,
    marginBottom: 12,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: theme.colors.primary,
    backgroundColor: theme.colors.creamAlt,
  },
  couponName: {
    fontSize: 16,
    fontWeight: "600",
    color: theme.colors.heading,
  },
  couponDiscount: {
    fontSize: 18,
    fontWeight: "700",
    color: theme.colors.primary,
    marginTop: 4,
  },
  savedNoteBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    alignItems: "center",
  },
  savedNoteBox: {
    backgroundColor: "#fff",
    borderWidth: 2,
    borderColor: theme.colors.primary,
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingVertical: 14,
    marginHorizontal: 24,
  },
  savedNoteText: {
    fontSize: 14,
    color: theme.colors.primary,
    fontWeight: "600",
    textAlign: "center",
  },
});
