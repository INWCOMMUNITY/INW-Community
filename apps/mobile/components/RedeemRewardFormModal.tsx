import { useEffect, useState, useCallback } from "react";
import {
  Modal,
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet, apiPatch, apiPost } from "@/lib/api";

export type RedeemRewardSummary = {
  id: string;
  title: string;
  pointsRequired: number;
  redemptionLimit: number;
  timesRedeemed: number;
  needsShipping?: boolean;
};

type MeProfile = {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string | null;
  deliveryAddress?: {
    street?: string;
    city?: string;
    state?: string;
    zip?: string;
  } | null;
};

type Props = {
  visible: boolean;
  reward: RedeemRewardSummary | null;
  onClose: () => void;
  /** Called after successful redeem with points delta */
  onSuccess: (rewardId: string, pointsSpent: number) => void;
};

export function RedeemRewardFormModal({ visible, reward, onClose, onSuccess }: Props) {
  const [loadingMe, setLoadingMe] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [street, setStreet] = useState("");
  const [apt, setApt] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zip, setZip] = useState("");
  const [notes, setNotes] = useState("");

  const needsShipping = reward?.needsShipping === true;

  const resetFields = useCallback(() => {
    setError("");
    setFirstName("");
    setLastName("");
    setEmail("");
    setPhone("");
    setStreet("");
    setApt("");
    setCity("");
    setState("");
    setZip("");
    setNotes("");
  }, []);

  useEffect(() => {
    if (!visible || !reward) {
      return;
    }
    setLoadingMe(true);
    setError("");
    apiGet<MeProfile>("/api/me")
      .then((me) => {
        setFirstName(me.firstName?.trim() ?? "");
        setLastName(me.lastName?.trim() ?? "");
        setEmail(me.email?.trim() ?? "");
        setPhone(me.phone?.trim() ?? "");
        const a = me.deliveryAddress;
        if (a && typeof a === "object") {
          setStreet(typeof a.street === "string" ? a.street : "");
          setCity(typeof a.city === "string" ? a.city : "");
          setState(typeof a.state === "string" ? a.state : "");
          setZip(typeof a.zip === "string" ? a.zip : "");
        }
      })
      .catch(() => {
        setError("Could not load your profile.");
      })
      .finally(() => {
        setLoadingMe(false);
      });
  }, [visible, reward?.id]);

  const handleClose = () => {
    if (!submitting) {
      resetFields();
      onClose();
    }
  };

  const handleRedeemPoints = async () => {
    if (!reward) return;
    setError("");
    const fn = firstName.trim();
    const ln = lastName.trim();
    const em = email.trim();
    const ph = phone.trim();
    if (!fn || !ln) {
      setError("Please enter your first and last name.");
      return;
    }
    if (!em) {
      setError("Please enter your email.");
      return;
    }
    if (!ph) {
      setError("Please enter your phone number.");
      return;
    }
    const contactName = `${fn} ${ln}`.trim();
    let shippingAddress: {
      street: string;
      aptOrSuite?: string;
      city: string;
      state: string;
      zip: string;
    } | undefined;
    if (needsShipping) {
      const st = street.trim();
      const ci = city.trim();
      const stt = state.trim();
      const zp = zip.trim();
      if (!st || !ci || !stt || !zp) {
        setError("Please complete your shipping address.");
        return;
      }
      shippingAddress = {
        street: st,
        city: ci,
        state: stt,
        zip: zp,
      };
      const ap = apt.trim();
      if (ap) shippingAddress.aptOrSuite = ap;
    }

    setSubmitting(true);
    try {
      const patchBody: Record<string, unknown> = {
        firstName: fn,
        lastName: ln,
        phone: ph,
      };
      if (needsShipping) {
        patchBody.deliveryAddress = {
          street: street.trim(),
          city: city.trim(),
          state: state.trim(),
          zip: zip.trim(),
        };
      }
      await apiPatch("/api/me", patchBody);

      await apiPost<{
        ok?: boolean;
        redemptionId?: string;
      }>(`/api/rewards/${reward.id}/redeem`, {
        contactName,
        contactEmail: em,
        contactPhone: ph,
        notesToBusiness: notes.trim() || undefined,
        shippingAddress,
      });

      onSuccess(reward.id, reward.pointsRequired);
      resetFields();
      onClose();
    } catch (e) {
      const err = e as { error?: string };
      setError(typeof err?.error === "string" ? err.error : "Could not redeem. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!reward) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Pressable style={styles.backdrop} onPress={handleClose} />
        <View style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle} numberOfLines={2}>
              Redeem Reward
            </Text>
            <Pressable onPress={handleClose} hitSlop={12} disabled={submitting}>
              <Ionicons name="close" size={26} color="#333" />
            </Pressable>
          </View>
          <Text style={styles.rewardSubtitle} numberOfLines={2}>
            {reward.title}
          </Text>

          {loadingMe ? (
            <View style={styles.centerPad}>
              <ActivityIndicator size="large" color={theme.colors.primary} />
            </View>
          ) : (
            <ScrollView
              style={styles.formScroll}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {error ? <Text style={styles.errorText}>{error}</Text> : null}

              <Text style={styles.label}>First name</Text>
              <TextInput
                style={styles.input}
                value={firstName}
                onChangeText={setFirstName}
                autoCapitalize="words"
                editable={!submitting}
              />
              <Text style={styles.label}>Last name</Text>
              <TextInput
                style={styles.input}
                value={lastName}
                onChangeText={setLastName}
                autoCapitalize="words"
                editable={!submitting}
              />
              <Text style={styles.label}>Email</Text>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                editable={!submitting}
              />
              <Text style={styles.label}>Phone</Text>
              <TextInput
                style={styles.input}
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
                editable={!submitting}
              />

              {needsShipping ? (
                <>
                  <Text style={styles.sectionLabel}>Shipping address</Text>
                  <Text style={styles.label}>Street</Text>
                  <TextInput
                    style={styles.input}
                    value={street}
                    onChangeText={setStreet}
                    editable={!submitting}
                  />
                  <Text style={styles.label}>Apt / suite (optional)</Text>
                  <TextInput
                    style={styles.input}
                    value={apt}
                    onChangeText={setApt}
                    editable={!submitting}
                  />
                  <Text style={styles.label}>City</Text>
                  <TextInput
                    style={styles.input}
                    value={city}
                    onChangeText={setCity}
                    editable={!submitting}
                  />
                  <Text style={styles.label}>State</Text>
                  <TextInput
                    style={styles.input}
                    value={state}
                    onChangeText={setState}
                    editable={!submitting}
                  />
                  <Text style={styles.label}>ZIP</Text>
                  <TextInput
                    style={styles.input}
                    value={zip}
                    onChangeText={setZip}
                    keyboardType="default"
                    editable={!submitting}
                  />
                </>
              ) : null}

              <Text style={styles.label}>Notes to the business (optional)</Text>
              <TextInput
                style={[styles.input, styles.notes]}
                value={notes}
                onChangeText={setNotes}
                multiline
                placeholder="Delivery preferences, size, etc."
                editable={!submitting}
              />

              <Pressable
                style={[styles.submitBtn, submitting && styles.submitBtnDisabled]}
                onPress={handleRedeemPoints}
                disabled={submitting}
              >
                {submitting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.submitBtnText}>Redeem {reward.pointsRequired} pts</Text>
                )}
              </Pressable>
            </ScrollView>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: "92%",
    paddingBottom: 24,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  sheetTitle: { fontSize: 18, fontWeight: "700", color: "#111", flex: 1, paddingRight: 8 },
  rewardSubtitle: { fontSize: 14, color: "#666", paddingHorizontal: 16, marginBottom: 8 },
  formScroll: { paddingHorizontal: 16 },
  centerPad: { padding: 40, alignItems: "center" },
  label: { fontSize: 13, fontWeight: "600", color: "#444", marginBottom: 4, marginTop: 8 },
  sectionLabel: {
    fontSize: 15,
    fontWeight: "700",
    color: theme.colors.heading,
    marginTop: 12,
    marginBottom: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: "#111",
  },
  notes: { minHeight: 80, textAlignVertical: "top" },
  errorText: { color: "#c00", marginBottom: 8, fontSize: 14 },
  submitBtn: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
    marginTop: 20,
    marginBottom: 8,
  },
  submitBtnDisabled: { opacity: 0.7 },
  submitBtnText: { color: "#fff", fontSize: 17, fontWeight: "700" },
});
