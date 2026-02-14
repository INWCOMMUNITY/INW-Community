import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Pressable,
  Image,
  ActivityIndicator,
  Switch,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { theme as defaultTheme } from "@/lib/theme";
import { useTheme } from "@/contexts/ThemeContext";
import { apiGet, apiPost, apiUploadFile, getToken } from "@/lib/api";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

function toFullUrl(url: string): string {
  return url.startsWith("http") ? url : `${siteBase}${url.startsWith("/") ? "" : "/"}${url}`;
}

interface PoliciesResponse {
  sellerShippingPolicy?: string;
  sellerLocalDeliveryPolicy?: string;
  sellerPickupPolicy?: string;
  offerShipping?: boolean;
  offerLocalDelivery?: boolean;
  offerLocalPickup?: boolean;
}

interface Meta {
  categories: string[];
  sizes: string[];
}

const PLACEHOLDER_COLOR = "#888888";

export default function ResaleHubListScreen() {
  const theme = useTheme();
  const router = useRouter();
  const placeholderColor = PLACEHOLDER_COLOR;

  const [categories, setCategories] = useState<string[]>([]);
  const [sellerProfileShippingPolicy, setSellerProfileShippingPolicy] = useState("");
  const [offerShipping, setOfferShipping] = useState(true);
  const [offerLocalDelivery, setOfferLocalDelivery] = useState(true);
  const [offerLocalPickup, setOfferLocalPickup] = useState(true);
  const [policiesLoaded, setPoliciesLoaded] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [category, setCategory] = useState("");
  const [priceCents, setPriceCents] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [shippingDisabled, setShippingDisabled] = useState(false);
  const [shippingCostDollars, setShippingCostDollars] = useState("");
  const [shippingFree, setShippingFree] = useState(false);
  const [shippingPolicy, setShippingPolicy] = useState("");
  const [useSellerProfileShipping, setUseSellerProfileShipping] = useState(true);
  const [sellerProfileLocalDeliveryPolicy, setSellerProfileLocalDeliveryPolicy] = useState("");
  const [sellerProfilePickupPolicy, setSellerProfilePickupPolicy] = useState("");
  const [useSellerProfilePickup, setUseSellerProfilePickup] = useState(true);
  const [useSellerProfileLocalDelivery, setUseSellerProfileLocalDelivery] = useState(true);
  const [localDeliveryAvailable, setLocalDeliveryAvailable] = useState(false);
  const [localDeliveryFeeDollars, setLocalDeliveryFeeDollars] = useState("");
  const [localDeliveryTerms, setLocalDeliveryTerms] = useState("");
  const [inStorePickupAvailable, setInStorePickupAvailable] = useState(false);
  const [pickupTerms, setPickupTerms] = useState("");
  const [acceptOffers, setAcceptOffers] = useState(false);
  const [minOfferCents, setMinOfferCents] = useState("");

  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveShippingPolicy = useSellerProfileShipping
    ? sellerProfileShippingPolicy
    : shippingPolicy;

  useEffect(() => {
    apiGet<Meta>("/api/store-items?list=meta")
      .then((data) => setCategories((data as Meta).categories ?? []))
      .catch(() => setCategories([]));

    apiGet<PoliciesResponse>("/api/me/policies")
      .then((data) => {
        const pol = data as PoliciesResponse;
        setSellerProfileShippingPolicy(pol.sellerShippingPolicy ?? "");
        setSellerProfileLocalDeliveryPolicy(pol.sellerLocalDeliveryPolicy ?? "");
        setSellerProfilePickupPolicy(pol.sellerPickupPolicy ?? "");
        if (pol.sellerShippingPolicy && useSellerProfileShipping) {
          setShippingPolicy(pol.sellerShippingPolicy);
        }
        if (pol.sellerLocalDeliveryPolicy && useSellerProfileLocalDelivery) {
          setLocalDeliveryTerms(pol.sellerLocalDeliveryPolicy);
        } else if (pol.sellerLocalDeliveryPolicy) {
          setLocalDeliveryTerms((prev) => prev || (pol.sellerLocalDeliveryPolicy ?? ""));
        }
        if (pol.sellerPickupPolicy) {
          setPickupTerms((prev) => prev || (pol.sellerPickupPolicy ?? ""));
        }
        if (pol.offerShipping !== undefined) setOfferShipping(pol.offerShipping);
        if (pol.offerLocalDelivery !== undefined) setOfferLocalDelivery(pol.offerLocalDelivery);
        if (pol.offerLocalPickup !== undefined) setOfferLocalPickup(pol.offerLocalPickup);
        if (pol.offerShipping === false) setShippingDisabled(true);
        if (pol.offerLocalDelivery === false) setLocalDeliveryAvailable(false);
        if (pol.offerLocalPickup === false) setInStorePickupAvailable(false);
        if (pol.offerLocalDelivery === false && pol.offerLocalPickup === false) {
          setShippingDisabled(false);
        }
      })
      .catch(() => {})
      .finally(() => setPoliciesLoaded(true));
  }, []);

  const syncShippingPolicy = () => {
    apiGet<PoliciesResponse>("/api/me/policies")
      .then((data) => {
        const pol = data as PoliciesResponse;
        const policy = pol.sellerShippingPolicy ?? "";
        setSellerProfileShippingPolicy(policy);
        setShippingPolicy(policy);
      })
      .catch(() => {});
  };

  const syncPickupPolicy = () => {
    apiGet<PoliciesResponse>("/api/me/policies")
      .then((data) => {
        const pol = data as PoliciesResponse;
        const policy = pol.sellerPickupPolicy ?? "";
        setSellerProfilePickupPolicy(policy);
        setPickupTerms(policy);
      })
      .catch(() => {});
  };

  const syncLocalDeliveryPolicy = () => {
    apiGet<PoliciesResponse>("/api/me/policies")
      .then((data) => {
        const pol = data as PoliciesResponse;
        const policy = pol.sellerLocalDeliveryPolicy ?? "";
        setSellerProfileLocalDeliveryPolicy(policy);
        setLocalDeliveryTerms(policy);
      })
      .catch(() => {});
  };

  const pickPhotos = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Allow access to photos.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      quality: 0.8,
    });
    if (result.canceled) return;
    setUploading(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) {
        setError("Sign in to upload photos.");
        return;
      }
      for (const asset of result.assets) {
        const formData = new FormData();
        formData.append("file", {
          uri: asset.uri,
          type: asset.mimeType ?? "image/jpeg",
          name: "photo.jpg",
        } as unknown as Blob);
        const { url } = await apiUploadFile("/api/upload", formData);
        const fullUrl = toFullUrl(url);
        setPhotos((p) => (p.includes(fullUrl) ? p : [...p, fullUrl]));
      }
    } catch (e) {
      setError((e as { error?: string })?.error ?? "Photo upload failed.");
    } finally {
      setUploading(false);
    }
  };

  const removePhoto = (url: string) => {
    setPhotos((p) => p.filter((u) => u !== url));
  };

  const handleSubmit = async () => {
    const price = Math.round(parseFloat(priceCents) * 100);
    const qty = parseInt(quantity, 10);
    const shipCost =
      shippingFree || !shippingCostDollars.trim()
        ? 0
        : Math.round(parseFloat(shippingCostDollars) * 100);
    const localFee = localDeliveryFeeDollars.trim()
      ? Math.round(parseFloat(localDeliveryFeeDollars) * 100)
      : null;
    const minOffer = minOfferCents.trim() ? Math.round(parseFloat(minOfferCents) * 100) : null;

    if (!title.trim()) {
      setError("Title is required");
      return;
    }
    if (!price || price < 1) {
      setError("Price must be at least $0.01");
      return;
    }
    if (!qty || qty < 1) {
      setError("Quantity must be at least 1");
      return;
    }
    if (shippingDisabled && !localDeliveryAvailable && !inStorePickupAvailable) {
      setError("You must offer at least one form of delivery (shipping, local delivery, or pickup).");
      return;
    }
    if (
      !shippingDisabled &&
      !(useSellerProfileShipping ? effectiveShippingPolicy : shippingPolicy).trim()
    ) {
      setError("Shipping policy is required when you offer shipping.");
      return;
    }
    if (
      localDeliveryAvailable &&
      !(useSellerProfileLocalDelivery ? sellerProfileLocalDeliveryPolicy : localDeliveryTerms).trim()
    ) {
      setError(
        useSellerProfileLocalDelivery
          ? "Set your Delivery Policy in Policies first, or uncheck \"Use policies from settings\" to add item-specific terms."
          : "Local delivery terms are required when you offer local delivery."
      );
      return;
    }
    if (
      inStorePickupAvailable &&
      !(useSellerProfilePickup ? sellerProfilePickupPolicy : pickupTerms).trim()
    ) {
      setError("Pickup terms are required when you offer local pickup.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await apiPost("/api/store-items", {
        title: title.trim(),
        description: description.trim() || null,
        photos,
        category: category.trim() || null,
        priceCents: price,
        quantity: qty,
        listingType: "resale",
        shippingDisabled,
        localDeliveryAvailable,
        inStorePickupAvailable,
        businessId: null,
        shippingCostCents:
          !shippingDisabled ? (shippingFree ? 0 : shipCost > 0 ? shipCost : null) : null,
        shippingPolicy:
          shippingDisabled || useSellerProfileShipping
            ? null
            : shippingPolicy.trim() || null,
        localDeliveryTerms:
          localDeliveryAvailable && !useSellerProfileLocalDelivery
            ? localDeliveryTerms.trim() || null
            : null,
        pickupTerms:
          inStorePickupAvailable && !useSellerProfilePickup
            ? pickupTerms.trim() || null
            : null,
        localDeliveryFeeCents: localFee,
        acceptOffers: acceptOffers || undefined,
        minOfferCents: acceptOffers && minOffer != null && minOffer >= 0 ? minOffer : null,
      });
      router.replace("/(tabs)/my-community");
    } catch (e) {
      setError((e as { error?: string })?.error ?? "Failed to create listing");
    } finally {
      setSubmitting(false);
    }
  };

  const showDeliveryOptions = offerShipping || offerLocalDelivery || offerLocalPickup;

  return (
    <View style={styles.screenWrapper}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {error && <Text style={styles.err}>{error}</Text>}

        <Text style={styles.label}>Photos *</Text>
        <View style={styles.photoRow}>
          {photos.map((url) => (
            <View key={url} style={styles.photoWrap}>
              <Image source={{ uri: url }} style={styles.photo} />
              <Pressable style={styles.removePhoto} onPress={() => removePhoto(url)}>
                <Text style={styles.removePhotoText}>×</Text>
              </Pressable>
            </View>
          ))}
          <Pressable
            style={({ pressed }) => [styles.addPhoto, pressed && { opacity: 0.8 }]}
            onPress={pickPhotos}
            disabled={uploading}
          >
            {uploading ? (
              <ActivityIndicator size="small" color={theme.colors.primary} />
            ) : (
              <Text style={styles.addPhotoText}>+ Add</Text>
            )}
          </Pressable>
        </View>

        <Text style={styles.label}>Title *</Text>
        <TextInput
          style={styles.input}
          placeholder="Item title"
          placeholderTextColor={placeholderColor}
          value={title}
          onChangeText={setTitle}
          maxLength={200}
        />

        <Text style={styles.label}>Description</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          placeholder="Describe your item"
          placeholderTextColor={placeholderColor}
          value={description}
          onChangeText={setDescription}
          multiline
          numberOfLines={4}
        />

        <Text style={styles.label}>Price ($) *</Text>
        <TextInput
          style={styles.input}
          placeholder="0.00"
          placeholderTextColor={placeholderColor}
          value={priceCents}
          onChangeText={setPriceCents}
          keyboardType="decimal-pad"
        />

        <Text style={styles.label}>Quantity *</Text>
        <TextInput
          style={styles.input}
          placeholder="1"
          placeholderTextColor={placeholderColor}
          value={quantity}
          onChangeText={setQuantity}
          keyboardType="number-pad"
        />

        <Text style={styles.label}>Category</Text>
        <TextInput
          style={styles.input}
          placeholder={categories.length ? `e.g. ${categories[0]}` : "Category"}
          placeholderTextColor={placeholderColor}
          value={category}
          onChangeText={setCategory}
        />

        {/* Accept offers - resale-specific */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Offers</Text>
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>Accept offers</Text>
            <Switch
              value={acceptOffers}
              onValueChange={setAcceptOffers}
              trackColor={{ false: "#ccc", true: theme.colors.cream }}
              thumbColor={theme.colors.primary}
            />
          </View>
          {acceptOffers && (
            <>
              <Text style={styles.label}>Minimum offer ($, optional)</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. 5.00"
                placeholderTextColor={placeholderColor}
                value={minOfferCents}
                onChangeText={setMinOfferCents}
                keyboardType="decimal-pad"
              />
            </>
          )}
        </View>

        {/* Delivery options - three toggles from policy */}
        {policiesLoaded && showDeliveryOptions && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Delivery options</Text>

            {offerShipping && (
              <>
                <View style={styles.switchRow}>
                  <Text style={styles.switchLabel}>Offer Shipping</Text>
                  <Switch
                    value={!shippingDisabled}
                    onValueChange={(v) => {
                      const nextDisabled = !v;
                      if (nextDisabled && !localDeliveryAvailable && !inStorePickupAvailable) {
                        setLocalDeliveryAvailable(true);
                      }
                      setShippingDisabled(nextDisabled);
                    }}
                    trackColor={{ false: "#ccc", true: theme.colors.cream }}
                    thumbColor={theme.colors.primary}
                  />
                </View>
                {!shippingDisabled && (
                  <>
                    <Text style={styles.label}>Shipping price ($)</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="e.g. 5.99"
                      placeholderTextColor={placeholderColor}
                      value={shippingCostDollars}
                      onChangeText={(v) => {
                        setShippingCostDollars(v);
                        if (v.trim()) setShippingFree(false);
                      }}
                      keyboardType="decimal-pad"
                      editable={!shippingFree}
                    />
                    <View style={styles.checkboxRow}>
                      <Pressable
                        style={({ pressed }) => [
                          styles.checkbox,
                          shippingFree && styles.checkboxChecked,
                          pressed && { opacity: 0.8 },
                        ]}
                        onPress={() => {
                          setShippingFree((prev) => {
                            if (!prev) setShippingCostDollars("");
                            return !prev;
                          });
                        }}
                      >
                        {shippingFree && <Text style={styles.checkboxCheck}>✓</Text>}
                      </Pressable>
                      <Text
                        style={styles.checkboxLabel}
                        onPress={() => {
                          setShippingFree((prev) => {
                            if (!prev) setShippingCostDollars("");
                            return !prev;
                          });
                        }}
                      >
                        Free
                      </Text>
                    </View>
                    <Text style={styles.label}>Shipping Policy</Text>
                    <View style={styles.policyRow}>
                      <TextInput
                        style={[
                          styles.input,
                          styles.textAreaSmall,
                          useSellerProfileShipping && styles.inputReadonly,
                        ]}
                        placeholder="e.g. 2-5 business days via USPS. Free over $50."
                        placeholderTextColor={placeholderColor}
                        value={useSellerProfileShipping ? effectiveShippingPolicy : shippingPolicy}
                        onChangeText={(v) => {
                          if (!useSellerProfileShipping) setShippingPolicy(v);
                        }}
                        editable={!useSellerProfileShipping}
                        multiline
                        numberOfLines={3}
                      />
                      <Pressable
                        style={({ pressed }) => [styles.syncBtn, pressed && { opacity: 0.8 }]}
                        onPress={syncShippingPolicy}
                      >
                        <Text style={styles.syncBtnText}>Sync</Text>
                      </Pressable>
                    </View>
                    <View style={styles.switchRow}>
                      <Text style={styles.switchLabel}>Use policies from settings</Text>
                      <Switch
                        value={useSellerProfileShipping}
                        onValueChange={(v) => {
                          setUseSellerProfileShipping(v);
                          if (v) setShippingPolicy("");
                        }}
                        trackColor={{ false: "#ccc", true: theme.colors.cream }}
                        thumbColor={theme.colors.primary}
                      />
                    </View>
                    <Text style={styles.hint}>
                      {useSellerProfileShipping
                        ? "Synced from your Policies screen. Uncheck to set item-specific policy."
                        : "Item-specific shipping policy."}
                    </Text>
                  </>
                )}
              </>
            )}

            {offerLocalDelivery && (
              <>
                <View style={styles.switchRow}>
                  <Text style={styles.switchLabel}>Offer Local Delivery</Text>
                  <Switch
                    value={localDeliveryAvailable}
                    onValueChange={(v) => {
                      if (!v && shippingDisabled && !inStorePickupAvailable) return;
                      setLocalDeliveryAvailable(v);
                    }}
                    trackColor={{ false: "#ccc", true: theme.colors.cream }}
                    thumbColor={theme.colors.primary}
                  />
                </View>
                {localDeliveryAvailable && (
                  <>
                    <Text style={styles.label}>Local delivery fee ($, optional)</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="e.g. 5.00 or leave blank for free"
                      placeholderTextColor={placeholderColor}
                      value={localDeliveryFeeDollars}
                      onChangeText={setLocalDeliveryFeeDollars}
                      keyboardType="decimal-pad"
                    />
                    <Text style={styles.label}>Local delivery terms</Text>
                    <View style={styles.policyRow}>
                      <TextInput
                        style={[
                          styles.input,
                          styles.textAreaSmall,
                          useSellerProfileLocalDelivery && styles.inputReadonly,
                        ]}
                        placeholder="e.g. Areas served, contact method, timing."
                        placeholderTextColor={placeholderColor}
                        value={
                          useSellerProfileLocalDelivery
                            ? sellerProfileLocalDeliveryPolicy
                            : localDeliveryTerms
                        }
                        onChangeText={(v) => {
                          if (!useSellerProfileLocalDelivery) setLocalDeliveryTerms(v);
                        }}
                        editable={!useSellerProfileLocalDelivery}
                        multiline
                        numberOfLines={3}
                      />
                      <Pressable
                        style={({ pressed }) => [styles.syncBtn, pressed && { opacity: 0.8 }]}
                        onPress={syncLocalDeliveryPolicy}
                      >
                        <Text style={styles.syncBtnText}>Sync</Text>
                      </Pressable>
                    </View>
                    <View style={styles.switchRow}>
                      <Text style={styles.switchLabel}>Use policies from settings</Text>
                      <Switch
                        value={useSellerProfileLocalDelivery}
                        onValueChange={(v) => {
                          setUseSellerProfileLocalDelivery(v);
                          if (v) setLocalDeliveryTerms("");
                        }}
                        trackColor={{ false: "#ccc", true: theme.colors.cream }}
                        thumbColor={theme.colors.primary}
                      />
                    </View>
                    <Text style={styles.hint}>
                      {useSellerProfileLocalDelivery
                        ? "Synced from your Policies screen. Uncheck to set item-specific terms."
                        : "Item-specific delivery terms."}
                    </Text>
                  </>
                )}
              </>
            )}

            {offerLocalPickup && (
              <>
                <View style={styles.switchRow}>
                  <Text style={styles.switchLabel}>Offer Local Pick Up</Text>
                  <Switch
                    value={inStorePickupAvailable}
                    onValueChange={(v) => {
                      if (!v && shippingDisabled && !localDeliveryAvailable) return;
                      setInStorePickupAvailable(v);
                    }}
                    trackColor={{ false: "#ccc", true: theme.colors.cream }}
                    thumbColor={theme.colors.primary}
                  />
                </View>
                {inStorePickupAvailable && (
                  <>
                    <Text style={styles.label}>Pickup terms</Text>
                    <View style={styles.policyRow}>
                      <TextInput
                        style={[
                          styles.input,
                          styles.textAreaSmall,
                          useSellerProfilePickup && styles.inputReadonly,
                        ]}
                        placeholder="e.g. Location, contact method, hours."
                        placeholderTextColor={placeholderColor}
                        value={
                          useSellerProfilePickup ? sellerProfilePickupPolicy : pickupTerms
                        }
                        onChangeText={(v) => {
                          if (!useSellerProfilePickup) setPickupTerms(v);
                        }}
                        editable={!useSellerProfilePickup}
                        multiline
                        numberOfLines={3}
                      />
                      <Pressable
                        style={({ pressed }) => [styles.syncBtn, pressed && { opacity: 0.8 }]}
                        onPress={syncPickupPolicy}
                      >
                        <Text style={styles.syncBtnText}>Sync</Text>
                      </Pressable>
                    </View>
                    <View style={styles.switchRow}>
                      <Text style={styles.switchLabel}>Use policies from settings</Text>
                      <Switch
                        value={useSellerProfilePickup}
                        onValueChange={(v) => {
                          setUseSellerProfilePickup(v);
                          if (v) setPickupTerms("");
                        }}
                        trackColor={{ false: "#ccc", true: theme.colors.cream }}
                        thumbColor={theme.colors.primary}
                      />
                    </View>
                    <Text style={styles.hint}>
                      {useSellerProfilePickup
                        ? "Synced from your Policies screen. Uncheck to set item-specific terms."
                        : "Item-specific pickup terms."}
                    </Text>
                  </>
                )}
              </>
            )}
          </View>
        )}

        <Pressable
          style={({ pressed }) => [
            styles.submitBtn,
            pressed && { opacity: 0.8 },
            submitting && styles.submitDisabled,
          ]}
          onPress={handleSubmit}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.submitBtnText}>List Item</Text>
          )}
        </Pressable>

        {policiesLoaded && !showDeliveryOptions && (
          <View style={[styles.section, { backgroundColor: "#f9f9f9", padding: 16 }]}>
            <Text style={styles.hint}>
              Set your fulfillment options in Policies (e.g. shipping, local delivery, pickup) to
              enable them here.
            </Text>
            <Pressable
              style={({ pressed }) => [
                styles.policiesBtn,
                pressed && { opacity: 0.8 },
              ]}
              onPress={() => router.push("/policies")}
            >
              <Text style={styles.policiesBtnText}>Open Policies</Text>
            </Pressable>
          </View>
        )}

        {!policiesLoaded && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color={theme.colors.primary} />
            <Text style={styles.loadingText}>Loading your policies…</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screenWrapper: { flex: 1, backgroundColor: "#fff" },
  container: { flex: 1, backgroundColor: "#fff" },
  content: { padding: 20, paddingBottom: 40 },
  err: { color: "#c62828", marginBottom: 16, fontSize: 14 },
  label: { fontSize: 14, fontWeight: "600", marginBottom: 8, color: "#000" },
  hint: { fontSize: 12, color: defaultTheme.colors.labelMuted, marginBottom: 12 },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginBottom: 16,
    color: defaultTheme.colors.text,
  },
  inputReadonly: { backgroundColor: "#f5f5f5" },
  textArea: { minHeight: 80, textAlignVertical: "top" },
  textAreaSmall: { minHeight: 60, textAlignVertical: "top" },
  photoRow: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginBottom: 16 },
  photoWrap: { position: "relative" },
  photo: { width: 80, height: 80, borderRadius: 8 },
  removePhoto: {
    position: "absolute",
    top: -8,
    right: -8,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#c62828",
    justifyContent: "center",
    alignItems: "center",
  },
  removePhotoText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  addPhoto: {
    width: 80,
    height: 80,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: defaultTheme.colors.primary,
    borderStyle: "dashed",
    justifyContent: "center",
    alignItems: "center",
  },
  addPhotoText: { color: defaultTheme.colors.primary, fontWeight: "600" },
  section: {
    borderTopWidth: 1,
    borderTopColor: "#eee",
    paddingTop: 16,
    marginTop: 8,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#000",
    marginBottom: 12,
  },
  switchRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  switchLabel: { fontSize: 14, color: "#000", flex: 1 },
  checkboxRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 16,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderWidth: 2,
    borderColor: "#ccc",
    borderRadius: 4,
    justifyContent: "center",
    alignItems: "center",
  },
  checkboxChecked: {
    backgroundColor: defaultTheme.colors.primary,
    borderColor: defaultTheme.colors.primary,
  },
  checkboxCheck: { color: "#fff", fontSize: 14, fontWeight: "700" },
  checkboxLabel: { fontSize: 14, color: "#000" },
  policyRow: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  syncBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    backgroundColor: "#fff",
  },
  syncBtnText: { color: "#000", fontSize: 14, fontWeight: "600" },
  submitBtn: {
    marginTop: 24,
    backgroundColor: defaultTheme.colors.primary,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
  },
  submitDisabled: { opacity: 0.7 },
  submitBtnText: { color: "#fff", fontWeight: "600", fontSize: 16 },
  policiesBtn: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderWidth: 2,
    borderColor: defaultTheme.colors.primary,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 8,
  },
  policiesBtnText: { color: defaultTheme.colors.primary, fontWeight: "600", fontSize: 15 },
  loadingOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(255,255,255,0.9)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  loadingText: { fontSize: 14, color: defaultTheme.colors.labelMuted, marginTop: 12 },
});
