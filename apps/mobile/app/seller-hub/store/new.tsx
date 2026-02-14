import React, { useState, useEffect, useLayoutEffect, useCallback, useRef } from "react";
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
import { useRouter, useLocalSearchParams } from "expo-router";
import { useNavigation, usePreventRemove } from "@react-navigation/native";
import * as ImagePicker from "expo-image-picker";
import { theme as defaultTheme } from "@/lib/theme";
import { useTheme } from "@/contexts/ThemeContext";
import { apiGet, apiPost, apiUploadFile, getToken } from "@/lib/api";
import { getDraft, saveDraft, deleteDraft, type StoreItemDraft } from "@/lib/drafts";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

function toFullUrl(url: string): string {
  return url.startsWith("http") ? url : `${siteBase}${url.startsWith("/") ? "" : "/"}${url}`;
}

interface Business {
  id: string;
  name: string;
  slug: string;
}

interface Meta {
  categories: string[];
  sizes: string[];
}

interface PoliciesResponse {
  sellerShippingPolicy?: string;
  sellerLocalDeliveryPolicy?: string;
  sellerPickupPolicy?: string;
  offerShipping?: boolean;
  offerLocalDelivery?: boolean;
  offerLocalPickup?: boolean;
}

type Variant = { name: string; options: string[] };

const PLACEHOLDER_COLOR = "#888888";

export default function ListItemScreen() {
  const theme = useTheme();
  const router = useRouter();
  const navigation = useNavigation();
  const params = useLocalSearchParams<{ draftId?: string }>();
  const draftId = params.draftId;
  const placeholderColor = PLACEHOLDER_COLOR;

  useLayoutEffect(() => {
    navigation.setOptions({
      title: "List an Item",
      contentStyle: { backgroundColor: "#fff" },
    });
  }, [navigation]);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [sellerProfileShippingPolicy, setSellerProfileShippingPolicy] = useState("");
  const [sellerProfileLocalDeliveryPolicy, setSellerProfileLocalDeliveryPolicy] = useState("");
  const [sellerProfilePickupPolicy, setSellerProfilePickupPolicy] = useState("");
  const [offerShipping, setOfferShipping] = useState(true);
  const [offerLocalDelivery, setOfferLocalDelivery] = useState(true);
  const [offerLocalPickup, setOfferLocalPickup] = useState(true);
  const [useSellerProfilePickup, setUseSellerProfilePickup] = useState(true);
  const [useSellerProfileLocalDelivery, setUseSellerProfileLocalDelivery] = useState(true);
  const [pickupTerms, setPickupTerms] = useState("");
  const [policiesLoaded, setPoliciesLoaded] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [category, setCategory] = useState("");
  const [priceCents, setPriceCents] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [listingType, setListingType] = useState<"new" | "resale">("new");
  const [shippingDisabled, setShippingDisabled] = useState(false);
  const [shippingCostDollars, setShippingCostDollars] = useState("");
  const [shippingFree, setShippingFree] = useState(false);
  const [shippingPolicy, setShippingPolicy] = useState("");
  const [useSellerProfileShipping, setUseSellerProfileShipping] = useState(true);
  const [localDeliveryAvailable, setLocalDeliveryAvailable] = useState(false);
  const [localDeliveryFeeDollars, setLocalDeliveryFeeDollars] = useState("");
  const [localDeliveryTerms, setLocalDeliveryTerms] = useState("");
  const [inStorePickupAvailable, setInStorePickupAvailable] = useState(false);
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [variants, setVariants] = useState<Variant[]>([]);

  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedDraft, setLoadedDraft] = useState(false);
  const isExitingRef = useRef(false);

  const hasContent =
    !!title.trim() ||
    !!description.trim() ||
    photos.length > 0 ||
    !!category.trim() ||
    !!priceCents ||
    (quantity !== "1" && !!quantity) ||
    variants.some((v) => v.name.trim() || v.options.length > 0) ||
    !!shippingCostDollars ||
    !!shippingPolicy.trim() ||
    !!localDeliveryTerms.trim() ||
    !!localDeliveryFeeDollars ||
    !!pickupTerms.trim();

  const saveDraftAndExit = useCallback(async () => {
    isExitingRef.current = true;
    await saveDraft({
      title,
      description,
      photos,
      category,
      priceCents,
      quantity,
      listingType,
      shippingDisabled,
      shippingCostDollars,
      shippingFree,
      shippingPolicy,
      useSellerProfileShipping,
      localDeliveryAvailable,
      localDeliveryFeeDollars,
      localDeliveryTerms,
      useSellerProfileLocalDelivery,
      inStorePickupAvailable,
      pickupTerms,
      useSellerProfilePickup,
      businessId,
      variants,
    });
    if (draftId) await deleteDraft(draftId);
    router.back();
  }, [
    title,
    description,
    photos,
    category,
    priceCents,
    quantity,
    listingType,
    shippingDisabled,
    shippingCostDollars,
    shippingFree,
    shippingPolicy,
    useSellerProfileShipping,
    localDeliveryAvailable,
    localDeliveryFeeDollars,
    localDeliveryTerms,
    useSellerProfileLocalDelivery,
    inStorePickupAvailable,
    pickupTerms,
    useSellerProfilePickup,
    businessId,
    variants,
    draftId,
    router,
  ]);

  useEffect(() => {
    if (draftId && !loadedDraft) {
      getDraft(draftId).then((draft) => {
        if (draft) {
          setTitle(draft.title);
          setDescription(draft.description);
          setPhotos(draft.photos);
          setCategory(draft.category);
          setPriceCents(draft.priceCents);
          setQuantity(draft.quantity);
          setListingType(draft.listingType);
          setShippingDisabled(draft.shippingDisabled);
          setShippingCostDollars(draft.shippingCostDollars);
          setShippingFree(draft.shippingFree);
          setShippingPolicy(draft.shippingPolicy);
          setUseSellerProfileShipping(draft.useSellerProfileShipping);
          setLocalDeliveryAvailable(draft.localDeliveryAvailable);
          setLocalDeliveryFeeDollars(draft.localDeliveryFeeDollars);
          setLocalDeliveryTerms(draft.localDeliveryTerms);
          setUseSellerProfileLocalDelivery(draft.useSellerProfileLocalDelivery ?? true);
          setInStorePickupAvailable(draft.inStorePickupAvailable);
          setPickupTerms(draft.pickupTerms ?? "");
          setUseSellerProfilePickup(draft.useSellerProfilePickup ?? true);
          setBusinessId(draft.businessId);
          setVariants(draft.variants);
        }
        setLoadedDraft(true);
      });
    } else if (!draftId) {
      setLoadedDraft(true);
    }
  }, [draftId, loadedDraft]);

  const shouldPreventRemove = hasContent && !submitting && !isExitingRef.current;
  usePreventRemove(shouldPreventRemove, ({ data }) => {
    Alert.alert(
      "Are you sure you want to exit item listing?",
      "Your changes may be lost.",
      [
        { text: "No", style: "cancel", onPress: () => {} },
        {
          text: "Yes",
          style: "destructive",
          onPress: () => {
            isExitingRef.current = true;
            navigation.dispatch(data.action);
          },
        },
        { text: "Save draft", onPress: () => saveDraftAndExit() },
      ]
    );
  });

  useEffect(() => {
    apiGet<Business[]>("/api/businesses?mine=1")
      .then((data) => {
        const list = Array.isArray(data) ? data : [];
        setBusinesses(list);
        if (list.length === 1) {
          setBusinessId(list[0].id);
        }
      })
      .catch(() => setBusinesses([]));
    apiGet<Meta>("/api/store-items?list=meta")
      .then((data) => setCategories((data as Meta).categories ?? []))
      .catch(() => setCategories([]));
    apiGet<PoliciesResponse>("/api/me/policies")
      .then((data) => {
        const pol = data as PoliciesResponse;
        setSellerProfileShippingPolicy(pol.sellerShippingPolicy ?? "");
        setSellerProfileLocalDeliveryPolicy(pol.sellerLocalDeliveryPolicy ?? "");
        setSellerProfilePickupPolicy(pol.sellerPickupPolicy ?? "");
        if (pol.sellerShippingPolicy && useSellerProfileShipping) setShippingPolicy(pol.sellerShippingPolicy);
        if (pol.sellerLocalDeliveryPolicy && useSellerProfileLocalDelivery) {
          setLocalDeliveryTerms(pol.sellerLocalDeliveryPolicy);
        } else if (pol.sellerLocalDeliveryPolicy) {
          setLocalDeliveryTerms((prev) => prev || (pol.sellerLocalDeliveryPolicy ?? ""));
        }
        if (pol.sellerPickupPolicy) setPickupTerms((prev) => prev || (pol.sellerPickupPolicy ?? ""));
        if (pol.offerShipping !== undefined) setOfferShipping(pol.offerShipping);
        if (pol.offerLocalDelivery !== undefined) setOfferLocalDelivery(pol.offerLocalDelivery);
        if (pol.offerLocalPickup !== undefined) setOfferLocalPickup(pol.offerLocalPickup);
        if (pol.offerShipping === false) setShippingDisabled(true);
        if (pol.offerLocalDelivery === false) setLocalDeliveryAvailable(false);
        if (pol.offerLocalPickup === false) setInStorePickupAvailable(false);
        if (pol.offerLocalDelivery === false && pol.offerLocalPickup === false) setShippingDisabled(false);
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

  const addVariantOption = (vi: number, value: string) => {
    if (!value.trim()) return;
    setVariants((prev) => {
      const next = [...prev];
      next[vi] = { ...next[vi], options: [...next[vi].options, value.trim()] };
      return next;
    });
  };

  const removeVariantOption = (vi: number, oi: number) => {
    setVariants((prev) => {
      const next = [...prev];
      next[vi] = {
        ...next[vi],
        options: next[vi].options.filter((_, i) => i !== oi),
      };
      return next;
    });
  };

  const effectiveShippingPolicy = useSellerProfileShipping
    ? sellerProfileShippingPolicy
    : shippingPolicy;

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
      listingType === "resale" &&
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
          ? "Set your Delivery Policy in Policies first, or uncheck \"Use seller profile default\" to add item-specific terms."
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

    const variantPayload =
      variants.filter((v) => v.name.trim() && v.options.length > 0).length > 0
        ? variants.filter((v) => v.name.trim() && v.options.length > 0)
        : null;

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
        listingType,
        shippingDisabled,
        localDeliveryAvailable,
        inStorePickupAvailable,
        businessId: businessId || null,
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
        variants: variantPayload,
      });
      (router.replace as (href: string) => void)("/seller-hub/store/items");
    } catch (e) {
      setError((e as { error?: string })?.error ?? "Failed to create listing");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.screenWrapper}>
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {error && <Text style={styles.err}>{error}</Text>}

      <View style={styles.typeRow}>
        <Text style={styles.label}>Listing type</Text>
        <View style={styles.typeBtns}>
          <Pressable
            style={({ pressed }) => [
              styles.typeBtn,
              listingType === "new" && styles.typeBtnActive,
              pressed && { opacity: 0.8 },
            ]}
            onPress={() => setListingType("new")}
          >
            <Text
              style={
                listingType === "new" ? styles.typeBtnTextActive : styles.typeBtnText
              }
            >
              New
            </Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [
              styles.typeBtn,
              listingType === "resale" && styles.typeBtnActive,
              pressed && { opacity: 0.8 },
            ]}
            onPress={() => setListingType("resale")}
          >
            <Text
              style={
                listingType === "resale"
                  ? styles.typeBtnTextActive
                  : styles.typeBtnText
              }
            >
              Resale
            </Text>
          </Pressable>
        </View>
      </View>

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

      {/* Delivery options - three toggles from policy */}
      {policiesLoaded && (offerShipping || offerLocalDelivery || offerLocalPickup) && (
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
                    value={
                      useSellerProfileShipping ? effectiveShippingPolicy : shippingPolicy
                    }
                    onChangeText={(v) => {
                      if (!useSellerProfileShipping) setShippingPolicy(v);
                    }}
                    editable={!useSellerProfileShipping}
                    multiline
                    numberOfLines={3}
                  />
                  <Pressable
                    style={({ pressed }) => [
                      styles.syncBtn,
                      pressed && { opacity: 0.8 },
                    ]}
                    onPress={syncShippingPolicy}
                  >
                    <Text style={styles.syncBtnText}>Sync</Text>
                  </Pressable>
                </View>
                <View style={styles.switchRow}>
                  <Text style={styles.switchLabel}>
                    Use seller profile default
                  </Text>
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
                    ? "Synced from your seller profile. Uncheck to set item-specific policy."
                    : "Item-specific shipping policy (overrides profile default)."}
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
                  <Text style={styles.switchLabel}>Use seller profile default</Text>
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
                    : "Item-specific delivery terms (overrides profile default)."}
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
                    style={({ pressed }) => [
                      styles.syncBtn,
                      pressed && { opacity: 0.8 },
                    ]}
                    onPress={syncPickupPolicy}
                  >
                    <Text style={styles.syncBtnText}>Sync</Text>
                  </Pressable>
                </View>
                <View style={styles.switchRow}>
                  <Text style={styles.switchLabel}>Use seller profile default</Text>
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
                    ? "Synced from your seller profile. Uncheck to set item-specific terms."
                    : "Item-specific pickup terms (overrides profile default)."}
                </Text>
              </>
            )}
          </>
        )}
      </View>
      )}

      {policiesLoaded && !(offerShipping || offerLocalDelivery || offerLocalPickup) && (
        <View style={[styles.section, { backgroundColor: "#f9f9f9", padding: 16 }]}>
          <Text style={styles.hint}>
            Set your fulfillment options in Policies (Policies screen or Seller Profile) to
            enable shipping, local delivery, and pickup here.
          </Text>
          <Pressable
            style={({ pressed }) => [
              styles.policiesBtn,
              pressed && { opacity: 0.8 },
            ]}
            onPress={() => (router.push as (href: string) => void)("/policies")}
          >
            <Text style={styles.policiesBtnText}>Open Policies</Text>
          </Pressable>
        </View>
      )}

      {!policiesLoaded && (
        <View style={[styles.section, { alignItems: "center", padding: 24 }]}>
          <ActivityIndicator size="small" color={theme.colors.primary} />
          <Text style={styles.hint}>Loading your policies…</Text>
        </View>
      )}

      {/* Option groups */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Options (Size, Color, etc.)</Text>
        <Text style={styles.hint}>
          Add option groups like Size - Small + Medium + Large.
        </Text>
        {variants.map((v, vi) => (
          <View key={vi} style={styles.variantCard}>
            <View style={styles.variantHeader}>
              <TextInput
                style={[styles.input, styles.variantName]}
                placeholder="Option name (e.g. Size)"
                placeholderTextColor={placeholderColor}
                value={v.name}
                onChangeText={(val) =>
                  setVariants((prev) => {
                    const next = [...prev];
                    next[vi] = { ...next[vi], name: val };
                    return next;
                  })
                }
              />
              <Pressable
                onPress={() =>
                  setVariants((prev) => prev.filter((_, i) => i !== vi))
                }
              >
                <Text style={styles.removeVariantText}>Remove</Text>
              </Pressable>
            </View>
            <View style={styles.variantOptions}>
              {v.options.map((opt, oi) => (
                <View key={oi} style={styles.optionChip}>
                  <Text style={styles.optionChipText}>{opt}</Text>
                  <Pressable
                    onPress={() => removeVariantOption(vi, oi)}
                    hitSlop={8}
                  >
                    <Text style={styles.optionChipRemove}>×</Text>
                  </Pressable>
                </View>
              ))}
              <AddOptionInput onAdd={(val) => addVariantOption(vi, val)} placeholderColor={placeholderColor} />
            </View>
          </View>
        ))}
        <Pressable
          style={({ pressed }) => [
            styles.addVariantBtn,
            pressed && { opacity: 0.8 },
          ]}
          onPress={() =>
            setVariants((prev) => [...prev, { name: "", options: [] }])
          }
        >
          <Text style={styles.addVariantBtnText}>+ Add option group</Text>
        </Pressable>
      </View>

      {businesses.length >= 2 && (
        <>
          <Text style={styles.label}>Which business is this item posted under?</Text>
          <View style={styles.bizRow}>
            <Pressable
              style={({ pressed }) => [
                styles.bizBtn,
                !businessId && styles.bizBtnActive,
                pressed && { opacity: 0.8 },
              ]}
              onPress={() => setBusinessId(null)}
            >
              <Text style={!businessId ? styles.bizBtnTextActive : styles.bizBtnText}>
                None
              </Text>
            </Pressable>
            {businesses.map((b) => (
              <Pressable
                key={b.id}
                style={({ pressed }) => [
                  styles.bizBtn,
                  businessId === b.id && styles.bizBtnActive,
                  pressed && { opacity: 0.8 },
                ]}
                onPress={() => setBusinessId(businessId === b.id ? null : b.id)}
              >
                <Text
                  style={
                    businessId === b.id
                      ? styles.bizBtnTextActive
                      : styles.bizBtnText
                  }
                >
                  {b.name}
                </Text>
              </Pressable>
            ))}
          </View>
        </>
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
          <Text style={styles.submitBtnText}>List an Item</Text>
        )}
      </Pressable>
    </ScrollView>
    </View>
  );
}

function AddOptionInput({
  onAdd,
  placeholderColor,
}: {
  onAdd: (value: string) => void;
  placeholderColor: string;
}) {
  const [val, setVal] = useState("");
  return (
    <View style={styles.addOptionRow}>
      <TextInput
        style={styles.addOptionInput}
        placeholder="+ Add (e.g. Small)"
        placeholderTextColor={placeholderColor}
        value={val}
        onChangeText={setVal}
        onSubmitEditing={() => {
          if (val.trim()) {
            onAdd(val.trim());
            setVal("");
          }
        }}
      />
      <Pressable
        style={({ pressed }) => [styles.addOptionBtn, pressed && { opacity: 0.8 }]}
        onPress={() => {
          if (val.trim()) {
            onAdd(val.trim());
            setVal("");
          }
        }}
      >
        <Text style={styles.addOptionBtnText}>+</Text>
      </Pressable>
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
  typeRow: { marginBottom: 16 },
  typeBtns: { flexDirection: "row", gap: 8, marginTop: 8 },
  typeBtn: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ccc",
  },
  typeBtnActive: {
    backgroundColor: defaultTheme.colors.primary,
    borderColor: defaultTheme.colors.primary,
  },
  typeBtnText: { color: "#333" },
  typeBtnTextActive: { color: "#fff", fontWeight: "600" },
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
  policiesBtn: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderWidth: 2,
    borderColor: defaultTheme.colors.primary,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 8,
  },
  policiesBtnText: {
    color: defaultTheme.colors.primary,
    fontWeight: "600",
    fontSize: 15,
  },
  variantCard: {
    backgroundColor: "#f9f9f9",
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  variantHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  variantName: { flex: 1, marginBottom: 0 },
  removeVariantText: { color: "#c62828", fontSize: 14 },
  variantOptions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    alignItems: "center",
  },
  optionChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  optionChipText: { fontSize: 14, color: defaultTheme.colors.labelMuted },
  optionChipRemove: { color: "#c62828", fontSize: 18, fontWeight: "700" },
  addOptionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  addOptionInput: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    padding: 8,
    fontSize: 14,
    width: 120,
    color: defaultTheme.colors.text,
  },
  addOptionBtn: {
    padding: 8,
  },
  addOptionBtnText: {
    color: defaultTheme.colors.primary,
    fontSize: 18,
    fontWeight: "700",
  },
  addVariantBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: defaultTheme.colors.primary,
    borderRadius: 8,
  },
  addVariantBtnText: {
    color: defaultTheme.colors.primary,
    fontWeight: "600",
  },
  bizRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 },
  bizBtn: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ccc",
  },
  bizBtnActive: {
    backgroundColor: defaultTheme.colors.creamAlt,
    borderColor: defaultTheme.colors.primary,
  },
  bizBtnText: { color: defaultTheme.colors.labelMuted },
  bizBtnTextActive: { color: defaultTheme.colors.primary, fontWeight: "600" },
  submitBtn: {
    marginTop: 24,
    backgroundColor: defaultTheme.colors.primary,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
  },
  submitDisabled: { opacity: 0.7 },
  submitBtnText: { color: "#fff", fontWeight: "600", fontSize: 16 },
});
