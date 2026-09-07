import { useEffect, useState } from "react";
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Switch,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { switchIosBackgroundColor, switchThumbColor, switchTrackColor, theme } from "@/lib/theme";
import { apiGet, apiPatch } from "@/lib/api";

interface PolicyData {
  sellerShippingPolicy?: string | null;
  sellerLocalDeliveryPolicy?: string | null;
  sellerPickupPolicy?: string | null;
  sellerReturnPolicy?: string | null;
  acceptReturns?: boolean;
  acceptReturnsDays?: number;
  chargeReturnShipping?: boolean;
  offerShipping?: boolean;
  offerLocalDelivery?: boolean;
  offerLocalPickup?: boolean;
}

const POLICY_FIELDS: { key: keyof PolicyData; label: string; placeholder: string; offerKey?: "offerShipping" | "offerLocalDelivery" | "offerLocalPickup"; offerLabel?: string }[] = [
  { key: "sellerShippingPolicy", label: "Shipping Policy", placeholder: "e.g. 2–5 business days via USPS. Free over $50.", offerKey: "offerShipping", offerLabel: "Do you offer shipping?" },
  { key: "sellerLocalDeliveryPolicy", label: "Delivery Policy", placeholder: "e.g. Areas served, contact method, timing.", offerKey: "offerLocalDelivery", offerLabel: "Do you offer local delivery?" },
  { key: "sellerPickupPolicy", label: "Pick-Up Policy", placeholder: "e.g. Location, contact method, hours.", offerKey: "offerLocalPickup", offerLabel: "Do you offer local pickup?" },
];

export default function PoliciesScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [values, setValues] = useState<Record<string, string>>({
    sellerShippingPolicy: "",
    sellerLocalDeliveryPolicy: "",
    sellerPickupPolicy: "",
    sellerReturnPolicy: "",
  });
  const [offerShipping, setOfferShipping] = useState(true);
  const [offerLocalDelivery, setOfferLocalDelivery] = useState(true);
  const [offerLocalPickup, setOfferLocalPickup] = useState(true);
  const [acceptReturns, setAcceptReturns] = useState(true);
  const [acceptReturnsDays, setAcceptReturnsDays] = useState("30");
  const [chargeReturnShipping, setChargeReturnShipping] = useState(false);

  useEffect(() => {
    apiGet<PolicyData>("/api/me")
      .then((data) => {
        setValues({
          sellerShippingPolicy: data?.sellerShippingPolicy ?? "",
          sellerLocalDeliveryPolicy: data?.sellerLocalDeliveryPolicy ?? "",
          sellerPickupPolicy: data?.sellerPickupPolicy ?? "",
          sellerReturnPolicy: data?.sellerReturnPolicy ?? "",
        });
        setOfferShipping(data?.offerShipping ?? true);
        setOfferLocalDelivery(data?.offerLocalDelivery ?? true);
        setOfferLocalPickup(data?.offerLocalPickup ?? true);
        setAcceptReturns(data?.acceptReturns !== false);
        setAcceptReturnsDays(String(data?.acceptReturnsDays ?? 30));
        setChargeReturnShipping(data?.chargeReturnShipping ?? false);
      })
      .catch(() => setError("Failed to load policies."))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setError("");
    setSaving(true);
    setSaved(false);
    try {
      await apiPatch("/api/me", {
        sellerShippingPolicy: values.sellerShippingPolicy.trim() || null,
        sellerLocalDeliveryPolicy: values.sellerLocalDeliveryPolicy.trim() || null,
        sellerPickupPolicy: values.sellerPickupPolicy.trim() || null,
        sellerReturnPolicy: values.sellerReturnPolicy.trim() || null,
        offerShipping,
        offerLocalDelivery,
        offerLocalPickup,
        acceptReturns,
        acceptReturnsDays: Math.min(365, Math.max(1, Number(acceptReturnsDays) || 30)),
        chargeReturnShipping,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError((e as { error?: string }).error ?? "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
    >
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Policies</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.intro}>
          Set shipping, pickup, delivery, and refund policies here. Buyers see these on your storefront.
        </Text>

        {POLICY_FIELDS.map(({ key, label, placeholder, offerKey, offerLabel }) => (
          <View key={key} style={styles.field}>
            {offerKey && offerLabel && (
              <View style={styles.checkboxRow}>
                <Switch
                  value={
                    offerKey === "offerShipping"
                      ? offerShipping
                      : offerKey === "offerLocalDelivery"
                        ? offerLocalDelivery
                        : offerLocalPickup
                  }
                  onValueChange={(v) => {
                    if (offerKey === "offerShipping") setOfferShipping(v);
                    else if (offerKey === "offerLocalDelivery") setOfferLocalDelivery(v);
                    else setOfferLocalPickup(v);
                  }}
                  trackColor={switchTrackColor()}
                  thumbColor={switchThumbColor(
                    offerKey === "offerShipping"
                      ? offerShipping
                      : offerKey === "offerLocalDelivery"
                        ? offerLocalDelivery
                        : offerLocalPickup,
                  )}
                  ios_backgroundColor={switchIosBackgroundColor}
                />
                <Text style={styles.checkboxLabel}>{offerLabel}</Text>
              </View>
            )}
            <Text style={styles.label}>{label}</Text>
            <TextInput
              style={styles.input}
              value={values[key]}
              onChangeText={(t) => setValues((v) => ({ ...v, [key]: t }))}
              placeholder={placeholder}
              placeholderTextColor={theme.colors.placeholder}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
              autoCorrect={true}
            />
          </View>
        ))}

        <View style={styles.field}>
          <Text style={styles.label}>Returns & Refunds</Text>
          <View style={styles.checkboxRow}>
            <Switch
              value={acceptReturns}
              onValueChange={setAcceptReturns}
              trackColor={switchTrackColor()}
              thumbColor={switchThumbColor(acceptReturns)}
              ios_backgroundColor={switchIosBackgroundColor}
            />
            <Text style={styles.checkboxLabel}>Accept returns</Text>
          </View>
          <Text style={styles.hint}>
            When off, buyers cannot request a return after an order ships. You can still cancel and
            refund an order before it ships.
          </Text>
          <Text style={[styles.label, !acceptReturns && styles.checkboxLabelDisabled]}>
            Accept returns for (days after delivery or pickup)
          </Text>
          <TextInput
            style={[styles.input, styles.daysInput, !acceptReturns && styles.inputDisabled]}
            value={acceptReturnsDays}
            onChangeText={(t) => setAcceptReturnsDays(t.replace(/[^0-9]/g, ""))}
            keyboardType="number-pad"
            editable={acceptReturns}
            placeholder="30"
            placeholderTextColor={theme.colors.placeholder}
          />
          <Text style={styles.label}>Refund policy</Text>
          <TextInput
            style={styles.input}
            value={values.sellerReturnPolicy}
            onChangeText={(t) => setValues((v) => ({ ...v, sellerReturnPolicy: t }))}
            placeholder="e.g. Returns within 14 days, unused items only."
            placeholderTextColor={theme.colors.placeholder}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
            autoCorrect={true}
          />
          <View style={styles.checkboxRow}>
            <Switch
              value={chargeReturnShipping}
              onValueChange={setChargeReturnShipping}
              disabled={!acceptReturns}
              trackColor={switchTrackColor()}
              thumbColor={switchThumbColor(chargeReturnShipping)}
              ios_backgroundColor={switchIosBackgroundColor}
            />
            <Text style={[styles.checkboxLabel, !acceptReturns && styles.checkboxLabelDisabled]}>
              Charge shipping for returns
            </Text>
          </View>
          <Text style={styles.hint}>
            When on, the Shippo return-label price is deducted from the buyer’s refund. You still pay
            Shippo for the label; you keep that amount from the order instead of refunding it.
          </Text>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          style={({ pressed }) => [
            styles.saveBtn,
            (saving || pressed) && styles.saveBtnDisabled,
          ]}
          onPress={handleSave}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.saveBtnText}>{saved ? "Saved!" : "Save"}</Text>
          )}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
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
    borderBottomWidth: 2,
    borderBottomColor: "#000",
  },
  backBtn: { padding: 8 },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: "700",
    color: "#fff",
    textAlign: "center",
  },
  headerSpacer: { width: 40 },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 32 },
  intro: {
    fontSize: 14,
    color: theme.colors.text,
    marginBottom: 20,
    lineHeight: 20,
  },
  field: { marginBottom: 20 },
  checkboxRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
    gap: 8,
  },
  checkboxLabel: {
    fontSize: 15,
    fontWeight: "600",
    color: theme.colors.heading,
    flex: 1,
  },
  checkboxLabelDisabled: { color: "#999" },
  hint: {
    fontSize: 13,
    color: theme.colors.text,
    lineHeight: 18,
    marginBottom: 12,
  },
  label: {
    fontSize: 16,
    fontWeight: "600",
    color: theme.colors.heading,
    marginBottom: 8,
  },
  input: {
    borderWidth: 2,
    borderColor: theme.colors.primary,
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
    color: theme.colors.text,
    minHeight: 100,
  },
  daysInput: { minHeight: 48, marginBottom: 12 },
  inputDisabled: { opacity: 0.5 },
  error: {
    fontSize: 14,
    color: "#c00",
    marginBottom: 16,
  },
  saveBtn: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 14,
    alignItems: "center",
    borderRadius: 8,
  },
  saveBtnDisabled: { opacity: 0.7 },
  saveBtnText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
  },
});
