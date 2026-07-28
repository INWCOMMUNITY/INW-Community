import { useEffect, useState, useCallback, useMemo } from "react";
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  useWindowDimensions,
  Linking,
  Share,
  RefreshControl,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from "react-native";
import { ScrollView as GHScrollView } from "react-native-gesture-handler";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { openAddressInMaps } from "@/lib/open-maps";
import { apiGet, apiPost, apiDelete, getToken } from "@/lib/api";
import { AppImage } from "@/components/AppImage";
import { ImageGalleryViewer } from "@/components/ImageGalleryViewer";
import { ShareToChatModal } from "@/components/ShareToChatModal";
import { useAuth } from "@/contexts/AuthContext";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

type TabType = "products" | "about" | "policies";

interface StoreItem {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  photos: string[];
  category: string | null;
  priceCents: number;
  quantity: number;
}

interface SellerStorefront {
  id: string;
  name: string;
  slug: string;
  shortDescription: string | null;
  fullDescription: string | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  logoUrl: string | null;
  coverPhotoUrl: string | null;
  address: string | null;
  city: string | null;
  categories: string[];
  hoursOfOperation: Record<string, string> | null;
  photos: string[];
  facebookUrl: string | null;
  instagramUrl: string | null;
  tiktokUrl: string | null;
  member: { id: string; firstName: string; lastName: string };
  memberSince: number;
  storeItems: StoreItem[];
  sellerLocalDeliveryPolicy: string | null;
  sellerPickupPolicy: string | null;
  sellerShippingPolicy: string | null;
  sellerReturnPolicy: string | null;
  offerShipping: boolean;
  offerLocalDelivery: boolean;
  offerLocalPickup: boolean;
  acceptMessagesForListings: boolean;
}

function resolveUrl(path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  return path.startsWith("http") ? path : `${siteBase}${path.startsWith("/") ? "" : "/"}${path}`;
}

const DAY_ORDER = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

export default function SellerStorefrontScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const cardWidth = (width - 16 * 3) / 2;

  const [seller, setSeller] = useState<SellerStorefront | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [followed, setFollowed] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>("products");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [galleryIndex, setGalleryIndex] = useState(0);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [hoursExpanded, setHoursExpanded] = useState(false);
  const [aboutExpanded, setAboutExpanded] = useState(true);
  const [messageModalOpen, setMessageModalOpen] = useState(false);
  const [messageText, setMessageText] = useState("");
  const [sendingMessage, setSendingMessage] = useState(false);
  const { member } = useAuth();

  const load = useCallback(
    async (isRefresh = false) => {
      if (!slug) return;
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError("");
      try {
        const data = await apiGet<SellerStorefront>(`/api/sellers/${encodeURIComponent(slug)}`);
        setSeller(data);
      } catch {
        setError("Seller not found");
        setSeller(null);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [slug]
  );

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!member || !seller) return;
    apiGet<{ followed: boolean }>(`/api/follow-business/${seller.id}/status`)
      .then((res) => setFollowed(res.followed))
      .catch(() => setFollowed(false));
  }, [member, seller?.id]);

  const handleFollowToggle = async () => {
    if (!member || !seller) return;
    const token = await getToken();
    if (!token) {
      router.push("/(auth)/login");
      return;
    }
    setFollowLoading(true);
    try {
      if (followed) {
        await apiDelete(`/api/follow-business/${seller.id}`);
        setFollowed(false);
      } else {
        await apiPost(`/api/follow-business/${seller.id}`, {});
        setFollowed(true);
      }
    } finally {
      setFollowLoading(false);
    }
  };

  const handleShare = async () => {
    if (!seller) return;
    try {
      await Share.share({
        message: `Check out ${seller.name}'s Storefront on NWC Community!\n${siteBase}/seller/${seller.slug}`,
        url: `${siteBase}/seller/${seller.slug}`,
      });
    } catch {}
  };

  const handleMessage = () => {
    if (!member) {
      router.push("/(auth)/login");
      return;
    }
    setMessageModalOpen(true);
  };

  const sendMessageToSeller = async () => {
    if (!seller || !messageText.trim()) return;
    const token = await getToken();
    if (!token) {
      Alert.alert(
        "Sign in required",
        "Please sign in to message the seller.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Sign in", onPress: () => router.push("/(auth)/login") },
        ]
      );
      return;
    }
    setSendingMessage(true);
    try {
      const conv = await apiPost<{ id: string }>("/api/direct-conversations", {
        addresseeId: seller.member.id,
        content: messageText.trim(),
      });
      setMessageModalOpen(false);
      setMessageText("");
      if (conv?.id) {
        router.push(`/messages/${conv.id}`);
      }
    } catch (e) {
      const err = e as { error?: string };
      Alert.alert("Error", err.error ?? "Could not send message. Please try again.");
    } finally {
      setSendingMessage(false);
    }
  };

  const openProduct = (item: StoreItem) => {
    router.push(`/product/${item.slug}`);
  };

  const categories = useMemo(() => {
    if (!seller) return [];
    const cats = new Set<string>();
    seller.storeItems.forEach((item) => {
      if (item.category) cats.add(item.category);
    });
    return Array.from(cats).sort();
  }, [seller?.storeItems]);

  const filteredItems = useMemo(() => {
    if (!seller) return [];
    if (!selectedCategory) return seller.storeItems;
    return seller.storeItems.filter((item) => item.category === selectedCategory);
  }, [seller?.storeItems, selectedCategory]);

  const galleryUrls = useMemo(() => {
    if (!seller?.photos?.length) return [];
    return seller.photos.map((p) => resolveUrl(p)).filter(Boolean) as string[];
  }, [seller?.photos]);

  if (loading && !refreshing) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  if (error || !seller) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{error || "Seller not found"}</Text>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backBtnText}>Go Back</Text>
        </Pressable>
      </View>
    );
  }

  const coverUrl = resolveUrl(seller.coverPhotoUrl);
  const logoUrl = resolveUrl(seller.logoUrl);
  const addressDisplay = [seller.address, seller.city].filter(Boolean).join(", ");
  const hasHours = seller.hoursOfOperation && Object.keys(seller.hoursOfOperation).length > 0;
  const hasPolicies = seller.sellerShippingPolicy || seller.sellerLocalDeliveryPolicy || 
                      seller.sellerPickupPolicy || seller.sellerReturnPolicy;
  const hasSocial = seller.facebookUrl || seller.instagramUrl || seller.tiktokUrl;

  const renderProductsTab = () => (
    <View style={styles.tabContent}>
      {categories.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.categoryScroll}
          contentContainerStyle={styles.categoryScrollContent}
        >
          <Pressable
            style={[styles.categoryChip, !selectedCategory && styles.categoryChipActive]}
            onPress={() => setSelectedCategory(null)}
          >
            <Text style={[styles.categoryChipText, !selectedCategory && styles.categoryChipTextActive]}>
              All ({seller.storeItems.length})
            </Text>
          </Pressable>
          {categories.map((cat) => {
            const count = seller.storeItems.filter((i) => i.category === cat).length;
            const isActive = selectedCategory === cat;
            return (
              <Pressable
                key={cat}
                style={[styles.categoryChip, isActive && styles.categoryChipActive]}
                onPress={() => setSelectedCategory(cat)}
              >
                <Text style={[styles.categoryChipText, isActive && styles.categoryChipTextActive]}>
                  {cat} ({count})
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
      {filteredItems.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="cube-outline" size={48} color="#ccc" />
          <Text style={styles.emptyStateText}>
            {selectedCategory ? `No products in "${selectedCategory}"` : "No products listed yet"}
          </Text>
        </View>
      ) : (
        <View style={styles.productGrid}>
          {filteredItems.map((item) => {
            const photoUrl = item.photos?.[0];
            return (
              <Pressable
                key={item.id}
                style={[styles.productCard, { width: cardWidth }]}
                onPress={() => openProduct(item)}
              >
                <View style={styles.productImageWrap}>
                  {photoUrl ? (
                    <AppImage
                      uri={photoUrl}
                      targetWidth={cardWidth}
                      style={styles.productImage}
                      resizeMode="cover"
                    />
                  ) : (
                    <View style={[styles.productImage, styles.productImagePlaceholder]}>
                      <Ionicons name="image-outline" size={32} color="#999" />
                    </View>
                  )}
                </View>
                <Text style={styles.productTitle} numberOfLines={2}>
                  {item.title}
                </Text>
                <Text style={styles.productPrice}>${(item.priceCents / 100).toFixed(2)}</Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );

  const renderAboutTab = () => (
    <View style={styles.tabContent}>
      {/* Stats Row */}
      <View style={styles.statsRow}>
        <View style={styles.statItem}>
          <Ionicons name="calendar-outline" size={20} color={theme.colors.primary} />
          <Text style={styles.statText}>Member since {seller.memberSince}</Text>
        </View>
        <View style={styles.statItem}>
          <Ionicons name="cube-outline" size={20} color={theme.colors.primary} />
          <Text style={styles.statText}>{seller.storeItems.length} items</Text>
        </View>
      </View>

      {/* Delivery Options Badges */}
      <View style={styles.deliveryBadges}>
        {seller.offerShipping && (
          <View style={styles.deliveryBadge}>
            <Ionicons name="airplane-outline" size={16} color={theme.colors.primary} />
            <Text style={styles.deliveryBadgeText}>Ships items</Text>
          </View>
        )}
        {seller.offerLocalPickup && (
          <View style={styles.deliveryBadge}>
            <Ionicons name="storefront-outline" size={16} color={theme.colors.primary} />
            <Text style={styles.deliveryBadgeText}>Local pickup</Text>
          </View>
        )}
        {seller.offerLocalDelivery && (
          <View style={styles.deliveryBadge}>
            <Ionicons name="car-outline" size={16} color={theme.colors.primary} />
            <Text style={styles.deliveryBadgeText}>Local delivery</Text>
          </View>
        )}
      </View>

      {/* Contact Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Contact</Text>
        {seller.phone && (
          <Pressable style={styles.contactRow} onPress={() => Linking.openURL(`tel:${seller.phone}`)}>
            <Ionicons name="call-outline" size={18} color={theme.colors.primary} />
            <Text style={styles.contactLink}>{seller.phone}</Text>
          </Pressable>
        )}
        {seller.email && (
          <Pressable style={styles.contactRow} onPress={() => Linking.openURL(`mailto:${seller.email}`)}>
            <Ionicons name="mail-outline" size={18} color={theme.colors.primary} />
            <Text style={styles.contactLink}>{seller.email}</Text>
          </Pressable>
        )}
        {seller.website && (
          <Pressable
            style={styles.contactRow}
            onPress={() => {
              const url = seller.website!.startsWith("http") ? seller.website! : `https://${seller.website}`;
              Linking.openURL(url);
            }}
          >
            <Ionicons name="globe-outline" size={18} color={theme.colors.primary} />
            <Text style={styles.contactLink}>{seller.website}</Text>
          </Pressable>
        )}
      </View>

      {/* Social Media */}
      {hasSocial && (
        <View style={styles.socialRow}>
          {seller.facebookUrl && (
            <Pressable
              style={styles.socialButton}
              onPress={() => Linking.openURL(seller.facebookUrl!)}
            >
              <Ionicons name="logo-facebook" size={22} color="#fff" />
            </Pressable>
          )}
          {seller.instagramUrl && (
            <Pressable
              style={styles.socialButton}
              onPress={() => Linking.openURL(seller.instagramUrl!)}
            >
              <Ionicons name="logo-instagram" size={22} color="#fff" />
            </Pressable>
          )}
          {seller.tiktokUrl && (
            <Pressable
              style={styles.socialButton}
              onPress={() => Linking.openURL(seller.tiktokUrl!)}
            >
              <Ionicons name="logo-tiktok" size={22} color="#fff" />
            </Pressable>
          )}
        </View>
      )}

      {/* Location */}
      {addressDisplay && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Location</Text>
          <View style={styles.contactRow}>
            <Ionicons name="location-outline" size={18} color={theme.colors.primary} />
            <Text style={styles.contactText}>{addressDisplay}</Text>
          </View>
          <Pressable
            style={styles.mapBtn}
            onPress={() => openAddressInMaps(addressDisplay)}
          >
            <Ionicons name="map-outline" size={18} color="#fff" />
            <Text style={styles.mapBtnText}>Open in Maps</Text>
          </Pressable>
        </View>
      )}

      {/* Hours of Operation */}
      {hasHours && (
        <View style={styles.section}>
          <Pressable style={styles.collapsibleHeader} onPress={() => setHoursExpanded(!hoursExpanded)}>
            <Text style={styles.sectionTitle}>Hours of Operation</Text>
            <Ionicons
              name={hoursExpanded ? "chevron-up" : "chevron-down"}
              size={20}
              color={theme.colors.primary}
            />
          </Pressable>
          {hoursExpanded && (
            <View style={styles.hoursContent}>
              {DAY_ORDER.map((day) => {
                const val = seller.hoursOfOperation?.[day];
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
        </View>
      )}

      {/* Gallery */}
      {galleryUrls.length > 0 && (
        <View style={styles.section}>
          <View style={styles.gallerySectionHeader}>
            <Text style={styles.sectionTitle}>Gallery</Text>
            <Text style={styles.galleryCountBadge}>{galleryUrls.length} photos</Text>
          </View>
          <GHScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.gallery}
            contentContainerStyle={styles.galleryContent}
          >
            {galleryUrls.map((uri, index) => (
              <Pressable
                key={`${index}-${uri}`}
                onPress={() => {
                  setGalleryIndex(index);
                  setGalleryOpen(true);
                }}
              >
                <AppImage
                  uri={uri}
                  targetWidth={200}
                  style={styles.galleryImage}
                  resizeMode="cover"
                />
              </Pressable>
            ))}
          </GHScrollView>
        </View>
      )}

      {/* About/Description */}
      {(seller.shortDescription || seller.fullDescription) && (
        <View style={styles.section}>
          <Pressable style={styles.collapsibleHeader} onPress={() => setAboutExpanded(!aboutExpanded)}>
            <Text style={styles.sectionTitle}>About</Text>
            <Ionicons
              name={aboutExpanded ? "chevron-up" : "chevron-down"}
              size={20}
              color={theme.colors.primary}
            />
          </Pressable>
          {aboutExpanded && (
            <View>
              {seller.shortDescription && (
                <Text style={styles.description}>{seller.shortDescription}</Text>
              )}
              {seller.fullDescription && (
                <Text style={[styles.description, seller.shortDescription && { marginTop: 12 }]}>
                  {seller.fullDescription}
                </Text>
              )}
            </View>
          )}
        </View>
      )}
    </View>
  );

  const renderPoliciesTab = () => (
    <View style={styles.tabContent}>
      {!hasPolicies ? (
        <View style={styles.emptyState}>
          <Ionicons name="document-text-outline" size={48} color="#ccc" />
          <Text style={styles.emptyStateText}>This seller hasn't set up policies yet.</Text>
        </View>
      ) : (
        <View style={styles.policiesContainer}>
          {seller.sellerShippingPolicy && (
            <View style={styles.policyCard}>
              <View style={styles.policyHeader}>
                <Ionicons name="airplane-outline" size={20} color={theme.colors.primary} />
                <Text style={styles.policyTitle}>Shipping Policy</Text>
              </View>
              <Text style={styles.policyText}>{seller.sellerShippingPolicy}</Text>
            </View>
          )}
          {seller.sellerLocalDeliveryPolicy && (
            <View style={styles.policyCard}>
              <View style={styles.policyHeader}>
                <Ionicons name="car-outline" size={20} color={theme.colors.primary} />
                <Text style={styles.policyTitle}>Local Delivery Policy</Text>
              </View>
              <Text style={styles.policyText}>{seller.sellerLocalDeliveryPolicy}</Text>
            </View>
          )}
          {seller.sellerPickupPolicy && (
            <View style={styles.policyCard}>
              <View style={styles.policyHeader}>
                <Ionicons name="storefront-outline" size={20} color={theme.colors.primary} />
                <Text style={styles.policyTitle}>Pickup Policy</Text>
              </View>
              <Text style={styles.policyText}>{seller.sellerPickupPolicy}</Text>
            </View>
          )}
          {seller.sellerReturnPolicy && (
            <View style={styles.policyCard}>
              <View style={styles.policyHeader}>
                <Ionicons name="refresh-outline" size={20} color={theme.colors.primary} />
                <Text style={styles.policyTitle}>Return Policy</Text>
              </View>
              <Text style={styles.policyText}>{seller.sellerReturnPolicy}</Text>
            </View>
          )}
        </View>
      )}
    </View>
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.topHeader, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} style={styles.headerBtn}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {seller.name}
        </Text>
        <Pressable onPress={() => setShareModalOpen(true)} style={styles.headerBtn}>
          <Ionicons name="share-outline" size={24} color="#fff" />
        </Pressable>
      </View>

      <ScrollView
        style={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />}
        stickyHeaderIndices={[2]}
      >
        {/* Cover + Logo with Gradient */}
        <View style={styles.coverWrap}>
          {coverUrl ? (
            <AppImage uri={coverUrl} targetWidth={width} style={styles.cover} resizeMode="cover" />
          ) : (
            <View style={[styles.cover, styles.coverPlaceholder]}>
              <Ionicons name="storefront" size={64} color="rgba(0,0,0,0.15)" />
            </View>
          )}
          <LinearGradient
            colors={["transparent", "rgba(0,0,0,0.6)"]}
            style={styles.coverGradient}
          />
          <View style={styles.logoOverlay}>
            {logoUrl ? (
              <AppImage uri={logoUrl} targetWidth={96} style={styles.logo} resizeMode="cover" />
            ) : (
              <View style={[styles.logo, styles.logoPlaceholder]}>
                <Ionicons name="business" size={40} color={theme.colors.primary} />
              </View>
            )}
          </View>
        </View>

        {/* Name + Actions */}
        <View style={styles.nameBlock}>
          <Text style={styles.name}>{seller.name}</Text>
          <View style={styles.actionRow}>
            <Pressable
              style={[styles.actionBtn, followed && styles.actionBtnActive]}
              onPress={handleFollowToggle}
              disabled={followLoading}
            >
              {followLoading ? (
                <ActivityIndicator size="small" color={followed ? "#fff" : theme.colors.primary} />
              ) : (
                <>
                  <Ionicons
                    name={followed ? "heart" : "heart-outline"}
                    size={18}
                    color={followed ? "#fff" : theme.colors.primary}
                  />
                  <Text style={[styles.actionBtnText, followed && styles.actionBtnTextActive]}>
                    {followed ? "Following" : "Follow"}
                  </Text>
                </>
              )}
            </Pressable>
            <Pressable style={styles.actionBtn} onPress={handleShare}>
              <Ionicons name="share-social-outline" size={18} color={theme.colors.primary} />
              <Text style={styles.actionBtnText}>Share</Text>
            </Pressable>
            {seller.acceptMessagesForListings && (
              <Pressable style={styles.actionBtn} onPress={handleMessage}>
                <Ionicons name="chatbubble-outline" size={18} color={theme.colors.primary} />
                <Text style={styles.actionBtnText}>Message</Text>
              </Pressable>
            )}
          </View>
        </View>

        {/* Tab Bar */}
        <View style={styles.tabBarContainer}>
          <View style={styles.tabBar}>
            <Pressable
              style={[styles.tab, activeTab === "products" && styles.tabActive]}
              onPress={() => setActiveTab("products")}
            >
              <Text style={[styles.tabText, activeTab === "products" && styles.tabTextActive]}>
                Products
              </Text>
            </Pressable>
            <Pressable
              style={[styles.tab, activeTab === "about" && styles.tabActive]}
              onPress={() => setActiveTab("about")}
            >
              <Text style={[styles.tabText, activeTab === "about" && styles.tabTextActive]}>
                About
              </Text>
            </Pressable>
            <Pressable
              style={[styles.tab, activeTab === "policies" && styles.tabActive]}
              onPress={() => setActiveTab("policies")}
            >
              <Text style={[styles.tabText, activeTab === "policies" && styles.tabTextActive]}>
                Policies
              </Text>
            </Pressable>
          </View>
        </View>

        {/* Tab Content */}
        {activeTab === "products" && renderProductsTab()}
        {activeTab === "about" && renderAboutTab()}
        {activeTab === "policies" && renderPoliciesTab()}

        <View style={{ height: 32 }} />
      </ScrollView>

      {/* Gallery Viewer */}
      <ImageGalleryViewer
        visible={galleryOpen}
        images={galleryUrls}
        initialIndex={galleryIndex}
        onClose={() => setGalleryOpen(false)}
      />

      {/* Share Modal */}
      <ShareToChatModal
        visible={shareModalOpen}
        onClose={() => setShareModalOpen(false)}
        sharedContent={{ type: "storefront", id: seller.id, slug: seller.slug }}
      />

      {/* Message Seller Modal */}
      <Modal
        visible={messageModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => !sendingMessage && setMessageModalOpen(false)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => !sendingMessage && setMessageModalOpen(false)}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={styles.modalContentWrap}
          >
            <Pressable style={styles.messageModal} onPress={(e) => e.stopPropagation()}>
              <Text style={styles.messageModalTitle}>Message {seller.name}</Text>
              <Text style={styles.messageModalHint}>
                Send a message to this seller
              </Text>
              <TextInput
                style={styles.messageInput}
                placeholder="Type your message..."
                placeholderTextColor={theme.colors.placeholder}
                value={messageText}
                onChangeText={setMessageText}
                editable={!sendingMessage}
                multiline
                numberOfLines={4}
                textAlignVertical="top"
                autoCorrect
              />
              <View style={styles.messageModalActions}>
                <Pressable
                  style={({ pressed }) => [
                    styles.messageCancelBtn,
                    pressed && { opacity: 0.8 },
                  ]}
                  onPress={() => setMessageModalOpen(false)}
                  disabled={sendingMessage}
                >
                  <Text style={styles.messageCancelText}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.messageSendBtn,
                    (!messageText.trim() || sendingMessage) && styles.messageSendBtnDisabled,
                  ]}
                  onPress={sendMessageToSeller}
                  disabled={!messageText.trim() || sendingMessage}
                >
                  {sendingMessage ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.messageSendText}>Send</Text>
                  )}
                </Pressable>
              </View>
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  scroll: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  errorText: { fontSize: 16, color: "#666", marginBottom: 16 },
  backBtn: { padding: 12, backgroundColor: theme.colors.primary, borderRadius: 8 },
  backBtnText: { color: "#fff", fontWeight: "600" },

  // Header
  topHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingBottom: 12,
    backgroundColor: theme.colors.primary,
  },
  headerBtn: { padding: 8 },
  headerTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: "600",
    color: "#fff",
    textAlign: "center",
  },

  // Cover
  coverWrap: { height: 200, backgroundColor: "#f0f0f0", position: "relative" },
  cover: { width: "100%", height: "100%" },
  coverPlaceholder: { alignItems: "center", justifyContent: "center" },
  coverGradient: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 80,
  },
  logoOverlay: {
    position: "absolute",
    left: "50%",
    bottom: -40,
    marginLeft: -40,
    width: 80,
    height: 80,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#fff",
    borderWidth: 3,
    borderColor: "#fff",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 8,
    zIndex: 10,
  },
  logo: { width: "100%", height: "100%" },
  logoPlaceholder: { alignItems: "center", justifyContent: "center", backgroundColor: "#f5f5f5" },

  // Name Block
  nameBlock: {
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 48,
    paddingBottom: 16,
    marginTop: 40,
    backgroundColor: "#fff",
  },
  name: {
    fontSize: 22,
    fontWeight: "700",
    color: theme.colors.heading,
    fontFamily: theme.fonts.heading,
    textAlign: "center",
    marginBottom: 12,
  },
  actionRow: {
    flexDirection: "row",
    gap: 10,
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: theme.colors.primary,
    backgroundColor: "#fff",
  },
  actionBtnActive: {
    backgroundColor: theme.colors.primary,
  },
  actionBtnText: {
    fontSize: 13,
    fontWeight: "600",
    color: theme.colors.primary,
  },
  actionBtnTextActive: {
    color: "#fff",
  },

  // Tab Bar
  tabBarContainer: {
    backgroundColor: "#fff",
    borderBottomWidth: 2,
    borderBottomColor: theme.colors.primary,
  },
  tabBar: {
    flexDirection: "row",
  },
  tab: {
    flex: 1,
    paddingVertical: 14,
    alignItems: "center",
  },
  tabActive: {
    borderBottomWidth: 3,
    borderBottomColor: theme.colors.primary,
    marginBottom: -2,
  },
  tabText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#666",
  },
  tabTextActive: {
    color: theme.colors.primary,
  },

  // Tab Content
  tabContent: {
    padding: 16,
  },

  // Products Tab
  categoryScroll: {
    marginBottom: 16,
    marginHorizontal: -16,
  },
  categoryScrollContent: {
    paddingHorizontal: 16,
    gap: 8,
  },
  categoryChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: "#f0f0f0",
    borderWidth: 1,
    borderColor: "#e0e0e0",
  },
  categoryChipActive: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  categoryChipText: {
    fontSize: 13,
    fontWeight: "500",
    color: "#666",
  },
  categoryChipTextActive: {
    color: "#fff",
  },
  productGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  productCard: {
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#fff",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  productImageWrap: { aspectRatio: 4 / 5 },
  productImage: { width: "100%", height: "100%" },
  productImagePlaceholder: { backgroundColor: "#f5f5f5", alignItems: "center", justifyContent: "center" },
  productTitle: { fontSize: 13, fontWeight: "600", color: "#000", padding: 10, paddingBottom: 4 },
  productPrice: { fontSize: 15, fontWeight: "700", color: theme.colors.primary, paddingHorizontal: 10, paddingBottom: 10 },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 48,
  },
  emptyStateText: {
    fontSize: 15,
    color: "#888",
    marginTop: 12,
  },

  // About Tab
  statsRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 24,
    marginBottom: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  statItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  statText: {
    fontSize: 14,
    color: theme.colors.text,
  },
  deliveryBadges: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 20,
  },
  deliveryBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: theme.colors.creamAlt ?? "#f5f5f5",
    borderWidth: 1,
    borderColor: theme.colors.primary,
  },
  deliveryBadgeText: {
    fontSize: 12,
    fontWeight: "500",
    color: theme.colors.primary,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: theme.colors.heading,
    marginBottom: 10,
  },
  contactRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 8,
  },
  contactText: {
    fontSize: 14,
    color: theme.colors.text,
  },
  contactLink: {
    fontSize: 14,
    color: theme.colors.primary,
  },
  socialRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 20,
  },
  socialButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  mapBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 10,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: theme.colors.primary,
  },
  mapBtnText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#fff",
  },
  collapsibleHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  hoursContent: {
    gap: 4,
  },
  hoursRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  hoursDay: {
    fontSize: 14,
    color: theme.colors.text,
    width: 100,
  },
  hoursVal: {
    fontSize: 14,
    color: theme.colors.text,
    flex: 1,
    textAlign: "right",
  },
  gallerySectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  galleryCountBadge: {
    fontSize: 12,
    fontWeight: "600",
    color: theme.colors.primary,
    backgroundColor: theme.colors.creamAlt ?? "#f5f5f5",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  gallery: {
    marginHorizontal: -16,
  },
  galleryContent: {
    paddingHorizontal: 16,
    gap: 10,
  },
  galleryImage: {
    width: 200,
    height: 150,
    borderRadius: 8,
  },
  description: {
    fontSize: 14,
    color: theme.colors.text,
    lineHeight: 22,
  },

  // Policies Tab
  policiesContainer: {
    gap: 16,
  },
  policyCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "#e0e0e0",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  policyHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 10,
  },
  policyTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: theme.colors.heading,
  },
  policyText: {
    fontSize: 14,
    color: theme.colors.text,
    lineHeight: 22,
  },

  // Message Modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalContentWrap: {
    width: "100%",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  messageModal: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 20,
    width: "100%",
    maxWidth: 400,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 8,
  },
  messageModalTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: theme.colors.heading,
    marginBottom: 4,
  },
  messageModalHint: {
    fontSize: 14,
    color: "#666",
    marginBottom: 16,
  },
  messageInput: {
    borderWidth: 2,
    borderColor: theme.colors.primary,
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
    color: theme.colors.text,
    minHeight: 100,
    maxHeight: 200,
  },
  messageModalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 12,
    marginTop: 16,
  },
  messageCancelBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: "#f0f0f0",
  },
  messageCancelText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#666",
  },
  messageSendBtn: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: theme.colors.primary,
    minWidth: 80,
    alignItems: "center",
  },
  messageSendBtnDisabled: {
    opacity: 0.5,
  },
  messageSendText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#fff",
  },
});
