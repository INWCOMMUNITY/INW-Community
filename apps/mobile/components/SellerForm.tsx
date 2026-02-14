/**
 * Seller signup form – contact details for order fulfillment.
 * Extracted for easy editing of layout, design, and fields.
 */
import { useState } from "react";
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
} from "react-native";
import { theme } from "@/lib/theme";

export interface SellerFormData {
  phone?: string | null;
  deliveryAddress?: {
    street?: string;
    city?: string;
    state?: string;
    zip?: string;
  } | null;
}

interface SellerFormProps {
  onSubmit: (data: SellerFormData) => void | Promise<void>;
  loading?: boolean;
  error?: string | null;
}

export function SellerForm({ onSubmit, loading, error }: SellerFormProps) {
  const [phone, setPhone] = useState("");
  const [street, setStreet] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zip, setZip] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    const data: SellerFormData = {
      phone: phone.trim() || null,
      deliveryAddress:
        street.trim() || city.trim() || state.trim() || zip.trim()
          ? {
              street: street.trim() || undefined,
              city: city.trim() || undefined,
              state: state.trim() || undefined,
              zip: zip.trim() || undefined,
            }
          : null,
    };
    setSubmitting(true);
    try {
      await onSubmit(data);
    } finally {
      setSubmitting(false);
    }
  };

  const isLoading = loading ?? submitting;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.form}>
          <Text style={styles.label}>Phone (optional)</Text>
          <TextInput
            style={styles.input}
            placeholder="(555) 123-4567"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            placeholderTextColor={theme.colors.placeholder}
          />
          <Text style={styles.sectionLabel}>Shipping address (optional)</Text>
          <TextInput
            style={styles.input}
            placeholder="Street"
            value={street}
            onChangeText={setStreet}
            placeholderTextColor={theme.colors.placeholder}
          />
          <View style={styles.row}>
            <TextInput
              style={[styles.input, styles.inputHalf]}
              placeholder="City"
              value={city}
              onChangeText={setCity}
              placeholderTextColor={theme.colors.placeholder}
            />
            <TextInput
              style={[styles.input, styles.inputQuarter]}
              placeholder="State"
              value={state}
              onChangeText={setState}
              placeholderTextColor={theme.colors.placeholder}
              autoCapitalize="characters"
            />
            <TextInput
              style={[styles.input, styles.inputQuarter]}
              placeholder="ZIP"
              value={zip}
              onChangeText={setZip}
              keyboardType="number-pad"
              placeholderTextColor={theme.colors.placeholder}
            />
          </View>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable
            style={[styles.button, isLoading && styles.buttonDisabled]}
            onPress={handleSubmit}
            disabled={isLoading}
          >
            {isLoading ? (
              <ActivityIndicator color={theme.colors.primary} />
            ) : (
              <Text style={styles.buttonText}>Complete registration</Text>
            )}
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { paddingBottom: 32 },
  form: {
    padding: 20,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: "#000",
    backgroundColor: theme.colors.primary,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: "#fff",
    marginBottom: 6,
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#fff",
    marginTop: 16,
    marginBottom: 8,
  },
  input: {
    borderWidth: 2,
    borderColor: "#000",
    borderRadius: 4,
    padding: 12,
    fontSize: 16,
    marginBottom: 12,
    color: "#000",
    backgroundColor: "#fff",
  },
  row: { flexDirection: "row", gap: 8 },
  inputHalf: { flex: 1 },
  inputQuarter: { flex: 0.5 },
  error: {
    color: "#fff",
    marginBottom: 12,
    fontSize: 14,
  },
  button: {
    backgroundColor: "#fff",
    paddingVertical: 12,
    alignItems: "center",
    borderRadius: 4,
    marginTop: 8,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: {
    color: theme.colors.primary,
    fontSize: 16,
    fontWeight: "600",
  },
});
