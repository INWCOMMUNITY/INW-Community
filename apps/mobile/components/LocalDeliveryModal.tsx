import { useState, useEffect, useCallback } from "react";
import {
  Modal,
  StyleSheet,
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  Platform,
  Switch,
  KeyboardAvoidingView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet, getToken } from "@/lib/api";

export interface LocalDeliveryDetails {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  deliveryAddress: { street: string; city: string; state: string; zip: string };
  availableDropOffTimes: string;
  note?: string;
  termsAcceptedAt?: string;
}

interface LocalDeliveryModalProps {
  visible: boolean;
  onClose: () => void;
  policyText?: string | null;
  initialForm?: Partial<LocalDeliveryDetails> | null;
  onSave: (form: LocalDeliveryDetails & { termsAcceptedAt?: string }) => void;
}

const emptyForm: LocalDeliveryDetails = {
  firstName: "",
  lastName: "",
  phone: "",
  email: "",
  deliveryAddress: { street: "", city: "", state: "", zip: "" },
  availableDropOffTimes: "",
  note: "",
};

function formFromInitial(initial: Partial<LocalDeliveryDetails> | null | undefined): LocalDeliveryDetails {
  return {
    firstName: initial?.firstName ?? "",
    lastName: initial?.lastName ?? "",
    phone: initial?.phone ?? "",
    email: initial?.email ?? "",
    deliveryAddress: {
      street: initial?.deliveryAddress?.street ?? "",
      city: initial?.deliveryAddress?.city ?? "",
      state: initial?.deliveryAddress?.state ?? "",
      zip: initial?.deliveryAddress?.zip ?? "",
    },
    availableDropOffTimes: initial?.availableDropOffTimes ?? "",
    note: initial?.note ?? "",
  };
}

export function LocalDeliveryModal({
  visible,
  onClose,
  policyText,
  initialForm,
  onSave,
}: LocalDeliveryModalProps) {
  const insets = useSafeAreaInsets();
  const [form, setForm] = useState<LocalDeliveryDetails>({ ...emptyForm });
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [validationError, setValidationError] = useState("");
  const [signedIn, setSignedIn] = useState(false);

  const mergeProfileIntoForm = useCallback(
    (
      base: LocalDeliveryDetails,
      d: {
        firstName?: string;
        lastName?: string;
        phone?: string | null;
        email?: string | null;
        deliveryAddress?: { street?: string; city?: string; state?: string; zip?: string };
      },
      onlyEmpty: boolean
    ): LocalDeliveryDetails => {
      const pick = (cur: string, next: string | null | undefined) => {
        const n = (next ?? "").trim();
        if (!n) return cur;
        if (onlyEmpty && cur.trim()) return cur;
        return n;
      };
      const addr = d.deliveryAddress;
      return {
        firstName: pick(base.firstName, d.firstName),
        lastName: pick(base.lastName, d.lastName),
        phone: pick(base.phone, d.phone),
        email: pick(base.email, d.email),
        deliveryAddress: {
          street: pick(base.deliveryAddress.street, addr?.street),
          city: pick(base.deliveryAddress.city, addr?.city),
          state: pick(base.deliveryAddress.state, addr?.state),
          zip: pick(base.deliveryAddress.zip, addr?.zip),
        },
        availableDropOffTimes: base.availableDropOffTimes,
        note: base.note,
      };
    },
    []
  );

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    (async () => {
      const base = formFromInitial(initialForm);
      setForm(base);
      setTermsAccepted(false);
      setValidationError("");
      const token = await getToken();
      if (cancelled) return;
      setSignedIn(!!token);
      if (!token) return;
      try {
        const d = await apiGet<{
          firstName?: string;
          lastName?: string;
          phone?: string | null;
          email?: string | null;
          deliveryAddress?: { street?: string; city?: string; state?: string; zip?: string };
        }>("/api/me");
        if (cancelled) return;
        setForm((prev) => mergeProfileIntoForm(prev, d, true));
      } catch {
        /* keep initialForm only */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, initialForm, mergeProfileIntoForm]);

  const handleRefreshFromProfile = async () => {
    try {
      const d = await apiGet<{
        firstName?: string;
        lastName?: string;
        phone?: string | null;
        email?: string | null;
        deliveryAddress?: { street?: string; city?: string; state?: string; zip?: string };
      }>("/api/me");
      setForm((prev) => mergeProfileIntoForm(prev, d, false));
      setValidationError("");
    } catch (e) {
      if (__DEV__) console.warn("[LocalDeliveryModal] autofill", e);
      setValidationError("Could not load your saved details. Enter them manually or try again.");
    }
  };

  const handleSave = () => {
    setValidationError("");
    const f = form;
    const hasPolicy = !!(policyText && String(policyText).trim());
    const fieldsOk =
      f.firstName.trim() &&
      f.lastName.trim() &&
      f.phone.trim() &&
      f.email.trim() &&
      f.deliveryAddress.street.trim() &&
      f.deliveryAddress.city.trim() &&
      f.deliveryAddress.state.trim() &&
      f.deliveryAddress.zip.trim() &&
      f.availableDropOffTimes.trim();
    const ok = fieldsOk && (!hasPolicy || termsAccepted);
    if (ok) {
      onSave({
        ...f,
        ...(hasPolicy ? { termsAcceptedAt: new Date().toISOString() } : {}),
      });
    } else {
      setValidationError(
        hasPolicy
          ? "Please fill all required fields and agree to the delivery terms."
          : "Please fill all required fields."
      );
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle={Platform.OS === "ios" ? "pageSheet" : "overFullScreen"}
      onRequestClose={onClose}
      transparent
    >
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropTouch} onPress={onClose} />
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.kav}
          keyboardVerticalOffset={Platform.OS === "ios" ? insets.top + 8 : 0}
        >
          <View style={styles.panel}>
            <View style={styles.header}>
              <Text style={styles.headerTitle}>Local Delivery – your details</Text>
              <Pressable onPress={onClose} style={styles.closeBtn}>
                <Ionicons name="close" size={24} color={theme.colors.heading} />
              </Pressable>
            </View>
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 32 }]}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
            >
              {policyText ? (
                <View style={styles.policyBox}>
                  <Text style={styles.policyLabel}>Seller's delivery terms:</Text>
                  <Text style={styles.policyText}>{policyText}</Text>
                </View>
              ) : null}
              {signedIn ? (
                <Pressable onPress={handleRefreshFromProfile} style={styles.autofillBtn}>
                  <Text style={styles.autofillText}>Refresh from my profile</Text>
                </Pressable>
              ) : null}
              <View style={styles.field}>
                <Text style={styles.label}>Delivery address *</Text>
                <TextInput
                  style={[styles.input, styles.streetInput]}
                  value={form.deliveryAddress.street}
                  onChangeText={(v) =>
                    setForm((f) => ({
                      ...f,
                      deliveryAddress: { ...f.deliveryAddress, street: v },
                    }))
                  }
                  placeholder="Street"
                  placeholderTextColor={theme.colors.placeholder}
                  autoCorrect={true}
                />
                <View style={styles.addressSecondRow}>
                  <TextInput
                    style={[styles.input, styles.inputThird]}
                    value={form.deliveryAddress.city}
                    onChangeText={(v) =>
                      setForm((f) => ({
                        ...f,
                        deliveryAddress: { ...f.deliveryAddress, city: v },
                      }))
                    }
                    placeholder="City"
                    placeholderTextColor={theme.colors.placeholder}
                    autoCorrect={true}
                  />
                  <TextInput
                    style={[styles.input, styles.inputThird]}
                    value={form.deliveryAddress.state}
                    onChangeText={(v) =>
                      setForm((f) => ({
                        ...f,
                        deliveryAddress: { ...f.deliveryAddress, state: v },
                      }))
                    }
                    placeholder="State"
                    placeholderTextColor={theme.colors.placeholder}
                    autoCorrect={true}
                  />
                  <TextInput
                    style={[styles.input, styles.inputThird]}
                    value={form.deliveryAddress.zip}
                    onChangeText={(v) =>
                      setForm((f) => ({
                        ...f,
                        deliveryAddress: { ...f.deliveryAddress, zip: v },
                      }))
                    }
                    placeholder="ZIP"
                    placeholderTextColor={theme.colors.placeholder}
                    keyboardType="numeric"
                    autoCorrect={true}
                  />
                </View>
              </View>
              <View style={styles.field}>
                <Text style={styles.label}>Available drop-off times *</Text>
                <TextInput
                  style={[styles.input, styles.textArea]}
                  value={form.availableDropOffTimes}
                  onChangeText={(v) => setForm((f) => ({ ...f, availableDropOffTimes: v }))}
                  placeholder="When you can receive the delivery"
                  placeholderTextColor={theme.colors.placeholder}
                  multiline
                  numberOfLines={2}
                  autoCorrect={true}
                />
              </View>
              <View style={styles.row}>
                <View style={styles.fieldHalf}>
                  <Text style={styles.label}>First name *</Text>
                  <TextInput
                    style={styles.input}
                    value={form.firstName}
                    onChangeText={(v) => setForm((f) => ({ ...f, firstName: v }))}
                    placeholder="First name"
                    placeholderTextColor={theme.colors.placeholder}
                    autoCapitalize="words"
                    autoCorrect={true}
                  />
                </View>
                <View style={styles.fieldHalf}>
                  <Text style={styles.label}>Last name *</Text>
                  <TextInput
                    style={styles.input}
                    value={form.lastName}
                    onChangeText={(v) => setForm((f) => ({ ...f, lastName: v }))}
                    placeholder="Last name"
                    placeholderTextColor={theme.colors.placeholder}
                    autoCapitalize="words"
                    autoCorrect={true}
                  />
                </View>
              </View>
              <View style={styles.field}>
                <Text style={styles.label}>Phone *</Text>
                <TextInput
                  style={styles.input}
                  value={form.phone}
                  onChangeText={(v) => setForm((f) => ({ ...f, phone: v }))}
                  placeholder="Phone"
                  placeholderTextColor={theme.colors.placeholder}
                  keyboardType="phone-pad"
                  autoCorrect={true}
                />
              </View>
              <View style={styles.field}>
                <Text style={styles.label}>Email *</Text>
                <TextInput
                  style={styles.input}
                  value={form.email}
                  onChangeText={(v) => setForm((f) => ({ ...f, email: v }))}
                  placeholder="Email"
                  placeholderTextColor={theme.colors.placeholder}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={true}
                />
              </View>
              <View style={styles.field}>
                <Text style={styles.label}>Note to seller (optional)</Text>
                <TextInput
                  style={[styles.input, styles.textArea]}
                  value={form.note ?? ""}
                  onChangeText={(v) => setForm((f) => ({ ...f, note: v }))}
                  placeholder="Add a note..."
                  placeholderTextColor={theme.colors.placeholder}
                  multiline
                  numberOfLines={2}
                  autoCorrect={true}
                />
              </View>
              {policyText && String(policyText).trim() ? (
                <View style={styles.termsRow}>
                  <Switch
                    value={termsAccepted}
                    onValueChange={setTermsAccepted}
                    trackColor={{ false: "#ccc", true: theme.colors.primary }}
                    thumbColor="#fff"
                  />
                  <Text style={styles.termsText}>
                    I understand and agree to the seller&apos;s delivery terms.
                  </Text>
                </View>
              ) : null}
              {validationError ? (
                <Text style={styles.errorText}>{validationError}</Text>
              ) : null}
              <View style={styles.actions}>
                <Pressable
                  style={({ pressed }) => [styles.saveBtn, pressed && { opacity: 0.8 }]}
                  onPress={handleSave}
                >
                  <Text style={styles.saveBtnText}>Save & continue</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.cancelBtn, pressed && { opacity: 0.8 }]}
                  onPress={onClose}
                >
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  backdropTouch: {
    ...StyleSheet.absoluteFillObject,
  },
  kav: {
    maxHeight: "92%",
  },
  panel: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: "100%",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 2,
    borderBottomColor: theme.colors.primary,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: theme.colors.heading,
    flex: 1,
  },
  closeBtn: {
    padding: 4,
  },
  scroll: {
    flexGrow: 0,
    maxHeight: 520,
  },
  scrollContent: {
    padding: 16,
  },
  policyBox: {
    padding: 12,
    marginBottom: 12,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: theme.colors.primary,
    backgroundColor: theme.colors.creamAlt,
  },
  policyLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: theme.colors.heading,
    marginBottom: 4,
  },
  policyText: {
    fontSize: 14,
    color: theme.colors.text,
    lineHeight: 20,
  },
  autofillBtn: {
    marginBottom: 16,
  },
  autofillText: {
    fontSize: 14,
    color: theme.colors.primary,
    textDecorationLine: "underline",
  },
  row: {
    flexDirection: "row",
    gap: 12,
  },
  field: {
    marginBottom: 12,
  },
  fieldHalf: {
    flex: 1,
  },
  label: {
    fontSize: 13,
    fontWeight: "500",
    color: theme.colors.text,
    marginBottom: 4,
  },
  input: {
    borderWidth: 2,
    borderColor: theme.colors.primary,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: "#000",
  },
  inputThird: {
    flex: 1,
  },
  streetInput: {
    marginBottom: 14,
  },
  addressSecondRow: {
    flexDirection: "row",
    gap: 12,
  },
  textArea: {
    minHeight: 60,
    textAlignVertical: "top",
  },
  termsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 8,
    marginBottom: 12,
  },
  termsText: {
    flex: 1,
    fontSize: 14,
    color: theme.colors.text,
  },
  errorText: {
    fontSize: 14,
    color: theme.colors.primary,
    marginBottom: 12,
  },
  actions: {
    flexDirection: "row",
    gap: 12,
    marginTop: 8,
  },
  saveBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: theme.colors.primary,
    alignItems: "center",
  },
  saveBtnText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
  },
  cancelBtn: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: theme.colors.primary,
    alignItems: "center",
  },
  cancelBtnText: {
    fontSize: 16,
    color: theme.colors.text,
  },
});
