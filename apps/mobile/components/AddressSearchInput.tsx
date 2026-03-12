import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { theme } from "@/lib/theme";
import { API_BASE } from "@/lib/api";

export type AddressValue = {
  street: string;
  aptOrSuite?: string;
  city: string;
  state: string;
  zip: string;
};

type Suggestion = { description: string; placeId: string };

type AddressSearchInputProps = {
  value: AddressValue;
  onChange: (addr: AddressValue, meta?: { fromPlaces?: boolean }) => void;
  placeholder?: string;
  showManualFallback?: boolean;
};

const DEBOUNCE_MS = 300;

function formatAddressLine(addr: AddressValue): string {
  const parts = [addr.street, addr.city, addr.state, addr.zip].filter(Boolean);
  return parts.join(", ") || "";
}

export function AddressSearchInput({
  value,
  onChange,
  placeholder = "Search for your address",
  showManualFallback = true,
}: AddressSearchInputProps) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [showList, setShowList] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasAddress = !!(value.street?.trim() && value.city?.trim() && value.state?.trim() && value.zip?.trim());

  const fetchSuggestions = useCallback(async (input: string) => {
    if (input.length < 3) {
      setSuggestions([]);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(
        `${API_BASE}/api/address-autocomplete?input=${encodeURIComponent(input)}`
      );
      const data = (await res.json()) as { suggestions?: Suggestion[] };
      setSuggestions(data.suggestions ?? []);
      setShowList(true);
    } catch {
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setSuggestions([]);
      setShowList(false);
      return;
    }
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      fetchSuggestions(query);
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, fetchSuggestions]);

  const handleSelectSuggestion = useCallback(
    async (suggestion: Suggestion) => {
      setShowList(false);
      setQuery("");
      setLoading(true);
      try {
        const res = await fetch(
          `${API_BASE}/api/address-details?placeId=${encodeURIComponent(suggestion.placeId)}`
        );
        const data = (await res.json()) as {
          street?: string;
          city?: string;
          state?: string;
          zip?: string;
          error?: string;
        };
        if (data.error || !res.ok) {
          setSuggestions([]);
          setLoading(false);
          return;
        }
        const next: AddressValue = {
          street: data.street ?? "",
          aptOrSuite: value.aptOrSuite ?? "",
          city: data.city ?? "",
          state: data.state ?? "",
          zip: data.zip ?? "",
        };
        onChange(next, { fromPlaces: true });
      } catch {
        // leave previous value
      } finally {
        setLoading(false);
      }
    },
    [onChange, value.aptOrSuite]
  );

  const handleChangeAddress = useCallback(
    (updates: Partial<AddressValue>) => {
      onChange({ ...value, ...updates }, { fromPlaces: false });
    },
    [value, onChange]
  );

  const handleClearSelection = useCallback(() => {
    onChange(
      { street: "", aptOrSuite: value.aptOrSuite ?? "", city: "", state: "", zip: "" },
      { fromPlaces: false }
    );
    setQuery("");
    setShowList(false);
  }, [onChange, value.aptOrSuite]);

  if (hasAddress && !showManual && !showList) {
    return (
      <View style={styles.block}>
        <View style={styles.summary}>
          <Text style={styles.summaryText}>
            {formatAddressLine(value)}
            {value.aptOrSuite?.trim() ? `, ${value.aptOrSuite}` : ""}
          </Text>
        </View>
        <View style={styles.actions}>
          <Pressable onPress={handleClearSelection} style={({ pressed }) => [styles.link, pressed && styles.pressed]}>
            <Text style={styles.linkText}>Change address</Text>
          </Pressable>
          {showManualFallback && (
            <Pressable onPress={() => setShowManual(true)} style={({ pressed }) => [styles.link, pressed && styles.pressed]}>
              <Text style={[styles.linkText, { color: theme.colors.text }]}>Enter manually</Text>
            </Pressable>
          )}
        </View>
        <TextInput
          style={styles.input}
          placeholder="Apt, suite (optional)"
          placeholderTextColor={theme.colors.placeholder}
          value={value.aptOrSuite ?? ""}
          onChangeText={(t) => handleChangeAddress({ aptOrSuite: t })}
        />
      </View>
    );
  }

  if (showManual) {
    return (
      <View style={styles.block}>
        <Pressable onPress={() => setShowManual(false)} style={({ pressed }) => [styles.link, pressed && styles.pressed]}>
          <Text style={styles.linkText}>Search for address instead</Text>
        </Pressable>
        <TextInput
          style={styles.input}
          placeholder="Street"
          placeholderTextColor={theme.colors.placeholder}
          value={value.street}
          onChangeText={(t) => handleChangeAddress({ street: t })}
        />
        <TextInput
          style={styles.input}
          placeholder="Apt, suite (optional)"
          placeholderTextColor={theme.colors.placeholder}
          value={value.aptOrSuite ?? ""}
          onChangeText={(t) => handleChangeAddress({ aptOrSuite: t })}
        />
        <View style={styles.row2}>
          <TextInput
            style={[styles.input, styles.inputHalf]}
            placeholder="City"
            placeholderTextColor={theme.colors.placeholder}
            value={value.city}
            onChangeText={(t) => handleChangeAddress({ city: t })}
          />
          <TextInput
            style={[styles.input, styles.inputHalf]}
            placeholder="State"
            placeholderTextColor={theme.colors.placeholder}
            value={value.state}
            onChangeText={(t) => handleChangeAddress({ state: t })}
            maxLength={2}
          />
        </View>
        <TextInput
          style={styles.input}
          placeholder="ZIP"
          placeholderTextColor={theme.colors.placeholder}
          value={value.zip}
          onChangeText={(t) => handleChangeAddress({ zip: t })}
          keyboardType="number-pad"
        />
      </View>
    );
  }

  return (
    <View style={styles.block}>
      <TextInput
        style={styles.input}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.placeholder}
        value={query}
        onChangeText={(t) => {
          setQuery(t);
          if (!t) setShowList(false);
        }}
        autoComplete="off"
      />
      {loading && (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={theme.colors.primary} />
          <Text style={styles.loadingText}>Searching…</Text>
        </View>
      )}
      {showList && suggestions.length > 0 && (
        <ScrollView style={styles.dropdown} nestedScrollEnabled>
          {suggestions.map((s) => (
            <Pressable
              key={s.placeId}
              style={({ pressed }) => [styles.suggestion, pressed && styles.pressed]}
              onPress={() => handleSelectSuggestion(s)}
            >
              <Text style={styles.suggestionText} numberOfLines={2}>{s.description}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
      {showManualFallback && (
        <Pressable onPress={() => setShowManual(true)} style={({ pressed }) => [styles.link, pressed && styles.pressed]}>
          <Text style={[styles.linkText, { color: theme.colors.text }]}>Enter address manually</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: 8 },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.primary,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: theme.colors.text,
  },
  inputHalf: { flex: 1 },
  row2: { flexDirection: "row", gap: 8 },
  summary: {
    borderWidth: 1,
    borderColor: theme.colors.primary,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  summaryText: { fontSize: 16, color: theme.colors.text },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  link: {},
  pressed: { opacity: 0.7 },
  linkText: { fontSize: 14, color: theme.colors.primary },
  loadingRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  loadingText: { fontSize: 14, color: theme.colors.text },
  dropdown: {
    maxHeight: 200,
    borderWidth: 1,
    borderColor: theme.colors.primary,
    borderRadius: 8,
    backgroundColor: theme.colors.background,
  },
  suggestion: { paddingHorizontal: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#eee" },
  suggestionText: { fontSize: 15, color: theme.colors.text },
});
