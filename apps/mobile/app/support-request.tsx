import { useEffect, useState, useCallback } from "react";
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiPost } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { BadgeEarnedPopup } from "@/components/BadgeEarnedPopup";
import type { EarnedBadgePayload } from "@/lib/share-utils";

export default function SupportRequestScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { member } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [earnedBadges, setEarnedBadges] = useState<EarnedBadgePayload[]>([]);
  const [badgePopupIndex, setBadgePopupIndex] = useState(-1);

  useEffect(() => {
    if (!member) return;
    const n = `${member.firstName ?? ""} ${member.lastName ?? ""}`.trim();
    if (n) setName((prev) => (prev.trim() ? prev : n));
    if (member.email) setEmail((prev) => (prev.trim() ? prev : member.email));
  }, [member?.id, member?.firstName, member?.lastName, member?.email]);

  const submit = useCallback(async () => {
    const n = name.trim();
    const em = email.trim();
    const ph = phone.trim();
    const sub = subject.trim();
    const msg = message.trim();
    if (!n) {
      Alert.alert("Name required", "Please enter your name.");
      return;
    }
    if (!em || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
      Alert.alert("Email required", "Please enter a valid email address.");
      return;
    }
    if (!sub) {
      Alert.alert("Subject required", "Please enter a short subject.");
      return;
    }
    if (msg.length < 10) {
      Alert.alert("Message too short", "Please enter at least 10 characters so we can help.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiPost<{ ok?: boolean; earnedBadges?: EarnedBadgePayload[] }>(
        "/api/nwc-requests",
        {
          name: n,
          email: em,
          ...(ph ? { phone: ph } : {}),
          subject: sub,
          message: msg,
        }
      );
      const badges = (res?.earnedBadges ?? []).filter(
        (b): b is EarnedBadgePayload =>
          !!b && typeof b.slug === "string" && typeof b.name === "string"
      );
      if (badges.length > 0) {
        setEarnedBadges(badges);
        setBadgePopupIndex(0);
      } else {
        Alert.alert(
          "Request sent",
          "Thanks — your message was saved. Our team can read it in the admin dashboard and reply to you at the email you provided.",
          [{ text: "OK", onPress: () => router.back() }]
        );
      }
    } catch (e) {
      const err = e as { error?: string; status?: number };
      const msg =
        err?.status === 429
          ? "Too many attempts. Wait a minute and try again, or use Email support from the profile menu."
          : err?.error ?? "Try again or use Email support from the profile menu.";
      Alert.alert("Could not send", msg);
    } finally {
      setSubmitting(false);
    }
  }, [name, email, phone, subject, message, router]);

  const finishAfterBadges = useCallback(() => {
    setBadgePopupIndex(-1);
    setEarnedBadges([]);
    Alert.alert(
      "Request sent",
      "Thanks — your message was saved. Our team can read it in the admin dashboard and reply to you at the email you provided.",
      [{ text: "OK", onPress: () => router.back() }]
    );
  }, [router]);

  const closeBadgePopup = useCallback(() => {
    const next = badgePopupIndex + 1;
    if (next < earnedBadges.length) {
      setBadgePopupIndex(next);
    } else {
      finishAfterBadges();
    }
  }, [badgePopupIndex, earnedBadges.length, finishAfterBadges]);

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={insets.top + 48}
    >
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Support & contact</Text>
      </View>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.intro}>
          Send a message to the Northwest Community team. It is saved for staff on the admin site; someone can
          email you back at the address you enter — usually within a few business days. You can add a phone number
          if you want a call or text back (optional).
        </Text>

        <Text style={styles.label}>Name</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="Your name"
          placeholderTextColor={theme.colors.placeholder}
          autoCapitalize="words"
          editable={!submitting}
        />

        <Text style={styles.label}>Email</Text>
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          placeholderTextColor={theme.colors.placeholder}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!submitting}
        />

        <Text style={styles.label}>Phone (optional)</Text>
        <TextInput
          style={styles.input}
          value={phone}
          onChangeText={setPhone}
          placeholder="For call or text back"
          placeholderTextColor={theme.colors.placeholder}
          keyboardType="phone-pad"
          autoCorrect={false}
          editable={!submitting}
        />

        <Text style={styles.label}>Subject</Text>
        <TextInput
          style={styles.input}
          value={subject}
          onChangeText={setSubject}
          placeholder="What is this about?"
          placeholderTextColor={theme.colors.placeholder}
          editable={!submitting}
        />

        <Text style={styles.label}>Message</Text>
        <TextInput
          style={[styles.input, styles.messageInput]}
          value={message}
          onChangeText={setMessage}
          placeholder="Describe your question or issue…"
          placeholderTextColor={theme.colors.placeholder}
          multiline
          textAlignVertical="top"
          editable={!submitting}
        />

        <Pressable
          style={({ pressed }) => [
            styles.submitBtn,
            (pressed || submitting) && styles.submitBtnPressed,
            submitting && styles.submitBtnDisabled,
          ]}
          onPress={submit}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.submitBtnText}>Send request</Text>
          )}
        </Pressable>
      </ScrollView>
      {badgePopupIndex >= 0 && badgePopupIndex < earnedBadges.length && (
        <BadgeEarnedPopup
          visible
          onClose={closeBadgePopup}
          badgeName={earnedBadges[badgePopupIndex].name}
          badgeSlug={earnedBadges[badgePopupIndex].slug}
          badgeDescription={earnedBadges[badgePopupIndex].description}
        />
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: "#fff" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingBottom: 12,
    backgroundColor: theme.colors.primary,
    gap: 8,
  },
  backBtn: { padding: 4 },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: "600",
    color: "#fff",
  },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 40 },
  intro: {
    fontSize: 15,
    color: theme.colors.text,
    lineHeight: 22,
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: theme.colors.heading,
    marginBottom: 6,
    marginTop: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.primary,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === "ios" ? 12 : 10,
    fontSize: 16,
    color: theme.colors.text,
    marginBottom: 12,
  },
  messageInput: {
    minHeight: 140,
    paddingTop: Platform.OS === "ios" ? 12 : 10,
  },
  submitBtn: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  submitBtnPressed: { opacity: 0.9 },
  submitBtnDisabled: { opacity: 0.7 },
  submitBtnText: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "700",
  },
});
