import { Pressable, StyleSheet, Text, View } from "react-native";
import { theme } from "@/lib/theme";
import {
  HANDLING_TIME_PRESETS,
  RETURN_LABEL_REASONS,
  handlingTimeBoldLine,
  showsFreeReturns,
  type HandlingTime,
  type ReasonLabelPayer,
  type ReturnLabelPayerMode,
  type SellerReturnLabelPolicy,
} from "@/lib/seller-return-label-policy";

export function SellerPolicyQuestions({
  sellerName,
  policy,
  onChange,
}: {
  sellerName: string;
  policy: SellerReturnLabelPolicy;
  onChange: (next: SellerReturnLabelPolicy) => void;
}) {
  const handlingLine = handlingTimeBoldLine(sellerName, policy.handlingTime);
  const payers: { value: ReturnLabelPayerMode; label: string }[] = [
    { value: "seller", label: "I do" },
    { value: "buyer", label: "The buyer" },
    { value: "by_reason", label: "By reason" },
  ];
  return (
    <View style={styles.wrap}>
      <Text style={styles.heading}>Shipping</Text>
      <Text style={styles.label}>Handling time</Text>
      <View style={styles.choiceRow}>
        {HANDLING_TIME_PRESETS.map((preset) => (
          <Pressable
            key={preset}
            style={[styles.chip, policy.handlingTime === preset && styles.chipOn]}
            onPress={() => onChange({ ...policy, handlingTime: preset })}
          >
            <Text style={[styles.chipText, policy.handlingTime === preset && styles.chipTextOn]}>
              {preset} days
            </Text>
          </Pressable>
        ))}
        <Pressable
          style={[styles.chip, policy.handlingTime === "custom" && styles.chipOn]}
          onPress={() => onChange({ ...policy, handlingTime: "custom" satisfies HandlingTime })}
        >
          <Text style={[styles.chipText, policy.handlingTime === "custom" && styles.chipTextOn]}>Custom</Text>
        </Pressable>
      </View>
      {handlingLine ? <Text style={styles.bold}>{handlingLine}</Text> : null}
      {policy.handlingTime === "custom" ? (
        <Text style={styles.hint}>Custom handling time does not add the bold shipping line.</Text>
      ) : null}

      <Text style={styles.heading}>Return policy</Text>
      <Text style={styles.label}>Who pays for the return label?</Text>
      {payers.map((payer) => (
        <Pressable
          key={payer.value}
          style={styles.radioRow}
          onPress={() => onChange({ ...policy, returnLabelPayer: payer.value })}
        >
          <View style={[styles.radio, policy.returnLabelPayer === payer.value && styles.radioOn]} />
          <Text style={styles.radioLabel}>{payer.label}</Text>
        </Pressable>
      ))}
      {policy.returnLabelPayer === "by_reason"
        ? RETURN_LABEL_REASONS.map((reason) => (
            <View key={reason} style={styles.reasonBlock}>
              <Text style={styles.reason}>{reason}</Text>
              <View style={styles.choiceRow}>
                {(
                  [
                    ["buyer", "Buyer pays"],
                    ["seller", "I pay"],
                  ] as const
                ).map(([value, label]) => (
                  <Pressable
                    key={value}
                    style={[styles.chip, policy.returnLabelPayerByReason[reason] === value && styles.chipOn]}
                    onPress={() =>
                      onChange({
                        ...policy,
                        returnLabelPayerByReason: {
                          ...policy.returnLabelPayerByReason,
                          [reason]: value satisfies ReasonLabelPayer,
                        },
                      })
                    }
                  >
                    <Text
                      style={[
                        styles.chipText,
                        policy.returnLabelPayerByReason[reason] === value && styles.chipTextOn,
                      ]}
                    >
                      {label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ))
        : null}
      {showsFreeReturns(policy) ? <Text style={styles.bold}>FREE RETURNS</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8, marginBottom: 8 },
  heading: { fontSize: 18, fontWeight: "700", color: "#111827", marginTop: 8 },
  label: { fontSize: 14, fontWeight: "600", color: "#374151" },
  hint: { fontSize: 13, color: "#6b7280" },
  bold: { fontSize: 15, fontWeight: "700", color: "#111827" },
  choiceRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: "#fff",
  },
  chipOn: { borderColor: theme.colors.primary, backgroundColor: theme.colors.cream },
  chipText: { fontSize: 13, color: "#374151" },
  chipTextOn: { color: theme.colors.primary, fontWeight: "700" },
  radioRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: "#9ca3af" },
  radioOn: { borderColor: theme.colors.primary, backgroundColor: theme.colors.primary },
  radioLabel: { fontSize: 15, color: "#111827" },
  reasonBlock: { gap: 6, marginTop: 6 },
  reason: { fontSize: 14, color: "#111827" },
});
