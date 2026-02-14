import { useState, useEffect } from "react";
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
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet, getToken } from "@/lib/api";

export interface PickupDetails {
  firstName: string;
  lastName: string;
  phone: string;
  email?: string;
  preferredPickupTime?: string;
  note?: string;
  termsAcceptedAt?: string;
}

interface PickupTermsModalProps {
  visible: boolean;
  onClose: () => void;
  policyText?: string | null;
  initialForm?: Partial<PickupDetails> | null;
  onSave: (form: PickupDetails & { termsAcceptedAt?: string }) => void;
}

const emptyForm: PickupDetails = {
  firstName: "",
  lastName: "",
  phone: "",
  email: "",
  preferredPickupTime: "",
  note: "",
};

export function PickupTermsModal({
  visible,
  onClose,
  policyText,
  initialForm,
  onSave,
}: PickupTermsModalProps) {
  const [form, setForm] = useState<PickupDetails>({ ...emptyForm });
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [validationError, setValidationError] = useState("");
  const [signedIn, setSignedIn] = useState(false);

  const hasPolicy = !!policyText && String(policyText).trim();

  useEffect(() => {
    getToken().then((t) => setSignedIn(!!t));
  }, [visible]);

  useEffect(() => {
    if (visible) {
      setForm({
        firstName: initialForm?.firstName ?? "",
        lastName: initialForm?.lastName ?? "",
        phone: initialForm?.phone ?? "",
        email: initialForm?.email ?? "",
        preferredPickupTime: initialForm?.preferredPickupTime ?? "",
        note: initialForm?.note ?? "",
      });
      setTermsAccepted(!!initialForm?.termsAcceptedAt);
      setValidationError("");
    }
  }, [visible, initialForm]);

  const handleAutofill = async () => {
    try {
      const d = await apiGet<{
        firstName?: string;
        lastName?: string;
        phone?: string | null;
        email?: string | null;
      }>("/api/me");
      if (d?.firstName) setForm((f) => ({ ...f, firstName: d.firstName! }));
      if (d?.lastName) setForm((f) => ({ ...f, lastName: d.lastName! }));
      if (d?.phone) setForm((f) => ({ ...f, phone: d.phone ?? "" }));
      if (d?.email) setForm((f) => ({ ...f, email: d.email ?? "" }));
    } catch {}
  };

  const handleSave = () => {
    setValidationError("");
    const f = form;
    const ok =
      f.firstName.trim() &&
      f.lastName.trim() &&
      f.phone.trim() &&
      (!hasPolicy || termsAccepted);
    if (ok) {
      onSave({
        ...f,
        termsAcceptedAt: hasPolicy ? new Date().toISOString() : undefined,
      });
      onClose();
    } else {
      setValidationError(
        hasPolicy
          ? "Please fill all required fields and agree to the terms."
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
        <View style={styles.panel}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Pick Up Form</Text>
            <Pressable onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={24} color={theme.colors.heading} />
            </Pressable>
          </View>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            {policyText ? (
              <View style={styles.policyBox}>
                <Text style={styles.policyLabel}>Seller's pickup terms:</Text>
                <Text style={styles.policyText}>{policyText}</Text>
              </View>
            ) : null}
            {signedIn ? (
              <Pressable onPress={handleAutofill} style={styles.autofillBtn}>
                <Text style={styles.autofillText}>Autofill from my profile</Text>
              </Pressable>
            ) : null}
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
              />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>Email (optional)</Text>
              <TextInput
                style={styles.input}
                value={form.email ?? ""}
                onChangeText={(v) => setForm((f) => ({ ...f, email: v }))}
                placeholder="Email"
                placeholderTextColor={theme.colors.placeholder}
                keyboardType="email-address"
                autoCapitalize="none"
              />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>Preferable Time of Pick Up</Text>
              <TextInput
                style={styles.input}
                value={form.preferredPickupTime ?? ""}
                onChangeText={(v) =>
                  setForm((f) => ({ ...f, preferredPickupTime: v }))
                }
                placeholder="e.g. Weekday mornings, Saturday after 2pm"
                placeholderTextColor={theme.colors.placeholder}
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
              />
            </View>
            {hasPolicy ? (
              <View style={styles.termsRow}>
                <Switch
                  value={termsAccepted}
                  onValueChange={setTermsAccepted}
                  trackColor={{ false: "#ccc", true: theme.colors.primary }}
                  thumbColor="#fff"
                />
                <Text style={styles.termsText}>
                  I understand and agree to the seller's pickup terms.
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
  panel: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: "90%",
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
    maxHeight: 500,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
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
