import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Pressable,
  ActivityIndicator,
  Linking,
} from "react-native";
import { theme } from "@/lib/theme";
import { apiGet, apiPost, apiPut } from "@/lib/api";

const EASYPOST_LOGIN = "https://www.easypost.com/users/sign_in";
const EASYPOST_BILLING = "https://www.easypost.com/account/billing";
const EASYPOST_API_KEYS = "https://www.easypost.com/account/api-keys";

type ReturnAddr = { street1?: string; street2?: string; city?: string; state?: string; zip?: string; company?: string };

export default function ShippingSetupScreen() {
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [returnAddr, setReturnAddr] = useState<ReturnAddr>({ street1: "", street2: "", city: "", state: "", zip: "", company: "" });
  const [returnSaving, setReturnSaving] = useState(false);
  const [returnSuccess, setReturnSuccess] = useState<string | null>(null);

  useEffect(() => {
    apiGet<ReturnAddr | null>("/api/shipping/return-address")
      .then((data) => {
        if (data && typeof data === "object")
          setReturnAddr({
            street1: data.street1 ?? "",
            street2: data.street2 ?? "",
            city: data.city ?? "",
            state: data.state ?? "",
            zip: data.zip ?? "",
            company: data.company ?? "",
          });
      })
      .catch(() => {});
  }, []);

  const openUrl = (url: string) => {
    Linking.openURL(url).catch(() => {});
  };

  const handleSaveReturnAddress = async () => {
    if (!returnAddr.street1?.trim() || !returnAddr.city?.trim() || !returnAddr.state?.trim() || !returnAddr.zip?.trim()) {
      setError("Street, city, state, and ZIP are required.");
      return;
    }
    setReturnSaving(true);
    setError(null);
    setReturnSuccess(null);
    try {
      await apiPut<{ ok: boolean }>("/api/shipping/return-address", returnAddr);
      setReturnSuccess("Return address saved. Used only for labels and packing slips.");
    } catch (e: unknown) {
      const err = e as { error?: string };
      setError(err?.error ?? "Failed to save");
    } finally {
      setReturnSaving(false);
    }
  };

  const handleSave = async () => {
    const key = apiKey.trim();
    if (!key) {
      setError("API key is required");
      return;
    }
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      await apiPost<{ connected: boolean }>("/api/shipping/connect", { apiKey: key });
      setSuccess("EasyPost connected. You can get rates and buy labels.");
      setApiKey("");
    } catch (e: unknown) {
      const err = e as { error?: string };
      setError(err?.error ?? "Failed to connect");
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Set Up EasyPost</Text>
      <Text style={styles.hint}>
        Connect your EasyPost account for shipping labels. You pay for labels with your own card.
      </Text>

      <Text style={styles.step}>Step 1: Log in to EasyPost</Text>
      <Pressable
        style={({ pressed }) => [styles.linkBtn, pressed && { opacity: 0.8 }]}
        onPress={() => openUrl(EASYPOST_LOGIN)}
      >
        <Text style={styles.linkText}>Log in to EasyPost</Text>
      </Pressable>

      <Text style={styles.step}>Step 2: Set up payment options</Text>
      <Text style={styles.stepHint}>
        Add a payment method (card or bank) in EasyPost so you can pay for labels. Labels are charged to your EasyPost account.
      </Text>
      <Pressable
        style={({ pressed }) => [styles.linkBtn, pressed && { opacity: 0.8 }]}
        onPress={() => openUrl(EASYPOST_BILLING)}
      >
        <Text style={styles.linkText}>Open EasyPost Billing</Text>
      </Pressable>

      <Text style={styles.step}>Step 3: Get your API key</Text>
      <Pressable
        style={({ pressed }) => [styles.linkBtn, pressed && { opacity: 0.8 }]}
        onPress={() => openUrl(EASYPOST_API_KEYS)}
      >
        <Text style={styles.linkText}>Open API Keys page</Text>
      </Pressable>

      <Text style={styles.step}>Step 4: Paste your API key</Text>
      <TextInput
        style={styles.input}
        placeholder="Paste EasyPost API key"
        placeholderTextColor={theme.colors.placeholder}
        value={apiKey}
        onChangeText={setApiKey}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        editable={!loading}
      />
      <Pressable
        style={({ pressed }) => [
          styles.saveBtn,
          pressed && { opacity: 0.8 },
          loading && styles.saveBtnDisabled,
        ]}
        onPress={handleSave}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <Text style={styles.saveBtnText}>Save & connect</Text>
        )}
      </Pressable>

      {success && <Text style={styles.success}>{success}</Text>}
      {error && <Text style={styles.err}>{error}</Text>}

      <Text style={styles.step}>Step 5: Set up return address</Text>
      <Text style={styles.stepHint}>
        Enter the return address you use in your EasyPost account. Used only for labels and packing slips.
      </Text>
      <View style={styles.exactAddrNote}>
        <Text style={styles.exactAddrTitle}>Copy the exact same address from EasyPost</Text>
        <Text style={styles.exactAddrText}>
          Use the same spelling, abbreviations, and formatting (e.g. St vs Street, CA vs California). If it doesn’t match EasyPost’s records, label purchase can fail.
        </Text>
      </View>
      <TextInput
        style={styles.input}
        placeholder="Company (optional)"
        placeholderTextColor={theme.colors.placeholder}
        value={returnAddr.company ?? ""}
        onChangeText={(t) => setReturnAddr((a) => ({ ...a, company: t }))}
      />
      <TextInput
        style={styles.input}
        placeholder="Street address *"
        placeholderTextColor={theme.colors.placeholder}
        value={returnAddr.street1 ?? ""}
        onChangeText={(t) => setReturnAddr((a) => ({ ...a, street1: t }))}
      />
      <TextInput
        style={styles.input}
        placeholder="Apt, suite (optional)"
        placeholderTextColor={theme.colors.placeholder}
        value={returnAddr.street2 ?? ""}
        onChangeText={(t) => setReturnAddr((a) => ({ ...a, street2: t }))}
      />
      <View style={{ flexDirection: "row", gap: 8 }}>
        <TextInput
          style={[styles.input, { flex: 1 }]}
          placeholder="City *"
          placeholderTextColor={theme.colors.placeholder}
          value={returnAddr.city ?? ""}
          onChangeText={(t) => setReturnAddr((a) => ({ ...a, city: t }))}
        />
        <TextInput
          style={[styles.input, { flex: 0.6 }]}
          placeholder="State *"
          placeholderTextColor={theme.colors.placeholder}
          value={returnAddr.state ?? ""}
          onChangeText={(t) => setReturnAddr((a) => ({ ...a, state: t }))}
        />
        <TextInput
          style={[styles.input, { flex: 0.8 }]}
          placeholder="ZIP *"
          placeholderTextColor={theme.colors.placeholder}
          value={returnAddr.zip ?? ""}
          onChangeText={(t) => setReturnAddr((a) => ({ ...a, zip: t }))}
        />
      </View>
      <Pressable
        style={({ pressed }) => [
          styles.saveBtn,
          pressed && { opacity: 0.8 },
          returnSaving && styles.saveBtnDisabled,
        ]}
        onPress={handleSaveReturnAddress}
        disabled={returnSaving}
      >
        {returnSaving ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <Text style={styles.saveBtnText}>Save return address</Text>
        )}
      </Pressable>
      {returnSuccess && <Text style={styles.success}>{returnSuccess}</Text>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  content: { padding: 20, paddingBottom: 40 },
  title: { fontSize: 20, fontWeight: "700", marginBottom: 8, color: theme.colors.heading },
  hint: { fontSize: 14, color: "#666", marginBottom: 24 },
  step: { fontSize: 16, fontWeight: "600", marginBottom: 8, color: "#333" },
  stepHint: { fontSize: 14, color: "#666", marginBottom: 12 },
  exactAddrNote: {
    backgroundColor: "#fffbeb",
    borderWidth: 1,
    borderColor: "#fcd34d",
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  exactAddrTitle: { fontSize: 14, fontWeight: "600", color: "#92400e", marginBottom: 6 },
  exactAddrText: { fontSize: 13, color: "#b45309", lineHeight: 20 },
  linkBtn: {
    marginBottom: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: theme.colors.creamAlt,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.cream,
  },
  linkText: { fontSize: 15, color: theme.colors.primary, fontWeight: "600" },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginBottom: 16,
  },
  saveBtn: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  saveBtnDisabled: { opacity: 0.7 },
  saveBtnText: { color: "#fff", fontWeight: "600", fontSize: 16 },
  success: { color: "#2e7d32", marginTop: 16, fontSize: 14 },
  err: { color: "#c62828", marginTop: 16, fontSize: 14 },
});
