import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useFocusEffect } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { theme } from "@/lib/theme";
import { apiGet, apiPatch, apiPost } from "@/lib/api";
import { airportStyles as styles } from "@/components/apps-airport/chrome";

type Connection = {
  id: string;
  shopId: string;
  shopName: string | null;
  status: string;
};

type ShippingProfile = { id: string; title: string };

function errMessage(e: unknown, fallback: string) {
  return (e as { error?: string }).error || fallback;
}

export default function EtsySettingsScreen() {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [profiles, setProfiles] = useState<ShippingProfile[]>([]);
  const [profileId, setProfileId] = useState("");
  const [taxonomyId, setTaxonomyId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const body = await apiGet<{ connections: Connection[] }>("/api/etsy/connection");
      const active = body.connections.find((c) => c.status === "ACTIVE") ?? null;
      setConnection(active);
      if (active) {
        const profilesBody = await apiGet<{
          profiles: ShippingProfile[];
          defaultShippingProfileId: string | null;
          defaultTaxonomyId: number | null;
        }>("/api/etsy/shipping-profiles");
        setProfiles(profilesBody.profiles ?? []);
        setProfileId(profilesBody.defaultShippingProfileId ?? "");
        setTaxonomyId(
          typeof profilesBody.defaultTaxonomyId === "number" && profilesBody.defaultTaxonomyId > 0
            ? String(profilesBody.defaultTaxonomyId)
            : ""
        );
      } else {
        setProfiles([]);
        setProfileId("");
        setTaxonomyId("");
      }
    } catch (e) {
      setError(errMessage(e, "Could not load Etsy connection."));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const onConnect = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const body = await apiPost<{ authorizeUrl?: string }>("/api/etsy/connect", {});
      if (!body.authorizeUrl) {
        setError("Could not start Etsy connection.");
        return;
      }
      await WebBrowser.openBrowserAsync(body.authorizeUrl);
      setMessage("If you finished connecting in the browser, reopen this screen to see the shop.");
      await load();
    } catch (e) {
      setError(errMessage(e, "Could not start Etsy connection."));
    } finally {
      setBusy(false);
    }
  };

  const onDisconnect = () => {
    if (!connection) return;
    Alert.alert("Disconnect Etsy?", "Listing sync to this shop will stop.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Disconnect",
        style: "destructive",
        onPress: () => {
          setBusy(true);
          void apiPost("/api/etsy/disconnect", { connectionId: connection.id })
            .then(async () => {
              setMessage("Etsy disconnected.");
              await load();
            })
            .catch((e) => setError(errMessage(e, "Could not disconnect Etsy.")))
            .finally(() => setBusy(false));
        },
      },
    ]);
  };

  const onSaveDefaults = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiPatch("/api/etsy/shipping-profiles", {
        defaultShippingProfileId: profileId || null,
        defaultTaxonomyId: taxonomyId.trim() ? taxonomyId.trim() : null,
      });
      setMessage("Etsy publish defaults saved.");
    } catch (e) {
      setError(errMessage(e, "Could not save Etsy defaults."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.subtitle}>
        Connect your Etsy shop to sync listings with INW. You authorize INW on Etsy; no shop URL is
        required.
      </Text>
      {message ? <Text style={styles.ok}>{message}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {loading ? <ActivityIndicator color={theme.colors.primary} /> : null}

      {!loading ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Status: {connection ? "Connected" : "Not connected"}</Text>
          <Text style={styles.cardBody}>
            {connection
              ? `Shop: ${connection.shopName ?? `Shop #${connection.shopId}`}`
              : "No Etsy shop connected yet."}
          </Text>
          <View style={{ marginTop: 14 }}>
            {!connection ? (
              <Pressable
                style={({ pressed }) => [
                  { backgroundColor: theme.colors.primary, borderRadius: 8, paddingVertical: 12, alignItems: "center" },
                  (busy || pressed) && { opacity: 0.85 },
                ]}
                disabled={busy}
                onPress={() => void onConnect()}
              >
                <Text style={{ color: "#fff", fontWeight: "700" }}>{busy ? "Connecting…" : "Connect Etsy"}</Text>
              </Pressable>
            ) : (
              <Pressable onPress={onDisconnect} disabled={busy}>
                <Text style={{ color: "#b91c1c", fontSize: 16 }}>Disconnect</Text>
              </Pressable>
            )}
          </View>
        </View>
      ) : null}

      {connection ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Publish defaults</Text>
          <Text style={styles.cardBody}>
            Required before List on Etsy. The shipping profile activates new listings. Category
            defaults to Art & Collectibles › Mixed Media › Other Assemblage when blank.
          </Text>
          <Text style={styles.label}>Default shipping profile</Text>
          <View style={styles.chipRow}>
            {profiles.map((profile) => {
              const on = profileId === profile.id;
              return (
                <Pressable
                  key={profile.id}
                  style={[styles.chip, on && styles.chipOn]}
                  onPress={() => setProfileId(profile.id)}
                >
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>{profile.title}</Text>
                </Pressable>
              );
            })}
          </View>
          {profiles.length === 0 ? (
            <Text style={styles.hint}>No shipping profiles were returned from Etsy yet.</Text>
          ) : null}
          <Text style={styles.label}>Default Etsy category ID (optional)</Text>
          <TextInput
            style={styles.input}
            keyboardType="number-pad"
            placeholder="101"
            placeholderTextColor="#888"
            value={taxonomyId}
            onChangeText={(value) => setTaxonomyId(value.replace(/[^\d]/g, ""))}
          />
          <Text style={styles.hint}>
            Must be a leaf seller-taxonomy id from Etsy. Leave blank to use 101.
          </Text>
          <Pressable
            style={({ pressed }) => [
              { backgroundColor: theme.colors.primary, borderRadius: 8, paddingVertical: 12, alignItems: "center", marginTop: 8 },
              (busy || pressed) && { opacity: 0.85 },
            ]}
            disabled={busy}
            onPress={() => void onSaveDefaults()}
          >
            <Text style={{ color: "#fff", fontWeight: "700" }}>{busy ? "Saving…" : "Save defaults"}</Text>
          </Pressable>
        </View>
      ) : null}
    </ScrollView>
  );
}
