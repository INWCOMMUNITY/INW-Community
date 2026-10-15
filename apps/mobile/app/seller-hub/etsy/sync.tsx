import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { theme } from "@/lib/theme";
import { apiGet, apiPatch, apiPost } from "@/lib/api";
import { HubButton, airportStyles as styles } from "@/components/apps-airport/chrome";

type EligibleListing = {
  storeItemId: string;
  title: string;
  priceCents: number;
  quantity: number;
  sku: string | null;
  supported?: boolean;
  unsupportedReason?: string | null;
  inventoryTracking?: string | null;
  etsyWhoMade?: string | null;
  etsyWhenMade?: string | null;
  etsyIsSupply?: boolean | null;
  howItsMadeMissing?: string[];
  linkedButNotLive?: boolean;
};

const WHO = [
  { id: "i_did", label: "I did" },
  { id: "collective", label: "A member of my shop" },
  { id: "someone_else", label: "Another company or person" },
] as const;

const WHEN = [
  { id: "2020_2026", label: "2020–2026" },
  { id: "2010_2019", label: "2010–2019" },
  { id: "2007_2009", label: "2007–2009" },
  { id: "before_2007", label: "Before 2007" },
  { id: "2000_2006", label: "2000–2006" },
  { id: "1990s", label: "1990s" },
  { id: "1980s", label: "1980s" },
  { id: "1970s", label: "1970s" },
  { id: "1960s", label: "1960s" },
  { id: "1950s", label: "1950s" },
  { id: "1940s", label: "1940s" },
  { id: "1930s", label: "1930s" },
  { id: "1920s", label: "1920s" },
  { id: "1910s", label: "1910s" },
  { id: "1900s", label: "1900s" },
  { id: "1800s", label: "1800s" },
  { id: "1700s", label: "1700s" },
  { id: "before_1700", label: "Before 1700" },
] as const;

const MISSING_LABEL: Record<string, string> = {
  who_made: "who made it",
  when_made: "when it was made",
  is_supply: "product or supply",
  taxonomy_id: "category",
};

function errMessage(e: unknown, fallback: string) {
  return (e as { error?: string }).error || fallback;
}

export default function EtsySyncScreen() {
  const router = useRouter();
  const [listings, setListings] = useState<EligibleListing[]>([]);
  const [connectionStatus, setConnectionStatus] = useState("LOADING");
  const [shippingReady, setShippingReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [modalListing, setModalListing] = useState<EligibleListing | null>(null);
  const [who, setWho] = useState("");
  const [when, setWhen] = useState("");
  const [supply, setSupply] = useState<boolean | null>(null);
  const [taxonomyId, setTaxonomyId] = useState("");

  const load = useCallback(async () => {
    setError(null);
    try {
      const body = await apiGet<{
        connectionStatus: string;
        connection?: { shippingProfileReady?: boolean };
        listings: EligibleListing[];
      }>("/api/etsy/listings/eligible");
      setConnectionStatus(body.connectionStatus);
      setShippingReady(Boolean(body.connection?.shippingProfileReady));
      setListings(body.listings ?? []);
    } catch (e) {
      setError(errMessage(e, "Could not load eligible listings."));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const openModal = (listing: EligibleListing) => {
    setWho(listing.etsyWhoMade ?? "");
    setWhen(listing.etsyWhenMade && listing.etsyWhenMade !== "made_to_order" ? listing.etsyWhenMade : "");
    setSupply(typeof listing.etsyIsSupply === "boolean" ? listing.etsyIsSupply : null);
    setTaxonomyId("");
    setModalListing(listing);
    setError(null);
  };

  const confirm = async () => {
    if (!modalListing) return;
    const madeToOrder = modalListing.inventoryTracking === "made_to_order";
    if (!who) {
      setError("Choose who made it.");
      return;
    }
    if (supply !== true && supply !== false) {
      setError("Choose whether this is a finished product or a supply/tool.");
      return;
    }
    if (!madeToOrder && !when) {
      setError("Choose when it was made.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiPatch(`/api/store-items/${modalListing.storeItemId}/etsy-attributes`, {
        etsyWhoMade: who,
        etsyWhenMade: madeToOrder ? "made_to_order" : when || null,
        etsyIsSupply: supply,
        ...(taxonomyId.trim() && /^\d+$/.test(taxonomyId.trim())
          ? { etsyTaxonomyId: Number.parseInt(taxonomyId.trim(), 10) }
          : {}),
      });
      const body = await apiPost<{ status?: string; error?: string }>("/api/etsy/listings/create", {
        storeItemId: modalListing.storeItemId,
      });
      setModalListing(null);
      setMessage(
        body.status === "already_mapped"
          ? "This listing is already on Etsy."
          : "Listing queued for Etsy."
      );
      await load();
    } catch (e) {
      setError(errMessage(e, "Could not start Etsy listing."));
    } finally {
      setBusy(false);
    }
  };

  if (loading && listings.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  const connected = connectionStatus === "ACTIVE" || connectionStatus === "CONNECTED";

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} />
      }
    >
      <Text style={styles.subtitle}>
        Publish an INW listing to Etsy. How it’s made is required. A default shipping profile must
        be saved in Connection Settings.
      </Text>
      {!shippingReady ? (
        <Text style={styles.issue}>Set a default Etsy shipping profile before listing.</Text>
      ) : null}
      {message ? <Text style={styles.ok}>{message}</Text> : null}
      {error && !modalListing ? <Text style={styles.error}>{error}</Text> : null}
      {!connected && connectionStatus !== "LOADING" ? (
        <HubButton label="Connection Settings" onPress={() => router.push("/seller-hub/etsy/settings" as never)} />
      ) : null}
      {listings.length === 0 ? (
        <Text style={styles.hint}>No eligible listings right now.</Text>
      ) : (
        listings.map((listing) => (
          <View key={listing.storeItemId} style={styles.listCard}>
            <Text style={styles.listTitle}>{listing.title}</Text>
            <Text style={styles.meta}>
              ${(listing.priceCents / 100).toFixed(2)} · Qty {listing.quantity}
              {listing.sku ? ` · ${listing.sku}` : ""}
            </Text>
            {listing.unsupportedReason ? <Text style={styles.issue}>{listing.unsupportedReason}</Text> : null}
            {listing.howItsMadeMissing?.length ? (
              <Text style={styles.issue}>
                Missing: {listing.howItsMadeMissing.map((code) => MISSING_LABEL[code] ?? code).join(", ")}
              </Text>
            ) : null}
            <Pressable
              disabled={listing.supported === false || !shippingReady || busy}
              onPress={() => openModal(listing)}
              style={{ marginTop: 8 }}
            >
              <Text style={{ color: theme.colors.primary, fontWeight: "700" }}>
                {listing.linkedButNotLive ? "Finish list on Etsy" : "List on Etsy"}
              </Text>
            </Pressable>
          </View>
        ))
      )}

      <Modal visible={modalListing != null} animationType="slide" transparent>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" }}>
          <View style={{ backgroundColor: "#fff", borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: "90%" }}>
            <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 32 }}>
              <Text style={styles.title}>{modalListing?.title}</Text>
              <Text style={styles.subtitle}>How it’s made</Text>
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <Text style={styles.label}>Who made it?</Text>
              <View style={styles.chipRow}>
                {WHO.map((option) => {
                  const on = who === option.id;
                  return (
                    <Pressable key={option.id} style={[styles.chip, on && styles.chipOn]} onPress={() => setWho(option.id)}>
                      <Text style={[styles.chipText, on && styles.chipTextOn]}>{option.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={styles.label}>What is it?</Text>
              <View style={styles.chipRow}>
                <Pressable style={[styles.chip, supply === false && styles.chipOn]} onPress={() => setSupply(false)}>
                  <Text style={[styles.chipText, supply === false && styles.chipTextOn]}>A finished product</Text>
                </Pressable>
                <Pressable style={[styles.chip, supply === true && styles.chipOn]} onPress={() => setSupply(true)}>
                  <Text style={[styles.chipText, supply === true && styles.chipTextOn]}>A supply or tool</Text>
                </Pressable>
              </View>
              {modalListing?.inventoryTracking !== "made_to_order" ? (
                <>
                  <Text style={styles.label}>When was it made?</Text>
                  <View style={styles.chipRow}>
                    {WHEN.map((option) => {
                      const on = when === option.id;
                      return (
                        <Pressable key={option.id} style={[styles.chip, on && styles.chipOn]} onPress={() => setWhen(option.id)}>
                          <Text style={[styles.chipText, on && styles.chipTextOn]}>{option.label}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </>
              ) : (
                <Text style={styles.hint}>Made to order — Etsy does not need a year.</Text>
              )}
              <Text style={styles.label}>Etsy category ID (optional)</Text>
              <TextInput
                style={styles.input}
                keyboardType="number-pad"
                placeholder="Leave blank for the shop default"
                placeholderTextColor="#888"
                value={taxonomyId}
                onChangeText={(value) => setTaxonomyId(value.replace(/[^\d]/g, ""))}
              />
              <View style={[styles.actions, { marginTop: 16 }]}>
                <HubButton label={busy ? "Listing…" : "List on Etsy"} disabled={busy} onPress={() => void confirm()} />
                <HubButton label="Cancel" tone="earth" disabled={busy} onPress={() => setModalListing(null)} />
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}
