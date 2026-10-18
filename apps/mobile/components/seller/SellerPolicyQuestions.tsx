import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { theme } from "@/lib/theme";
import {
  BUYER_FAULT_REASONS,
  HANDLING_TIME_PRESETS,
  SELLER_FAULT_REASONS,
  applyReasonGroup,
  reasonGroupSelection,
  type HandlingTime,
  type ReasonLabelPayer,
  type ReturnLabelPayerMode,
  type ReturnLabelReason,
  type SellerReturnLabelPolicy,
} from "@/lib/seller-return-label-policy";

export function SellerPolicyQuestions({
  policy,
  onChange,
}: {
  policy: SellerReturnLabelPolicy;
  onChange: (next: SellerReturnLabelPolicy) => void;
}) {
  const payers: { value: ReturnLabelPayerMode; label: string }[] = [
    { value: "seller", label: "I do" },
    { value: "buyer", label: "The Buyer" },
    { value: "by_reason", label: "By Reason" },
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
      {policy.handlingTime === "custom" ? (
        <Text style={styles.hint}>Custom handling time does not add the bold shipping line.</Text>
      ) : null}

      <Text style={styles.heading}>Return Policy</Text>
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
      {policy.returnLabelPayer === "by_reason" ? (
        <>
          <ReasonGroup title="Buyer fault" reasons={BUYER_FAULT_REASONS} policy={policy} onChange={onChange} />
          <ReasonGroup title="Seller fault" reasons={SELLER_FAULT_REASONS} policy={policy} onChange={onChange} />
          <Text style={styles.reason}>Other</Text>
          <View style={styles.choiceRow}>
            {(
              [
                ["buyer", "Buyer pays"],
                ["seller", "I pay"],
                ["later", "Decide at that time"],
              ] as const
            ).map(([value, label]) => (
              <Pressable
                key={value}
                style={[styles.chip, policy.returnLabelPayerByReason.Other === value && styles.chipOn]}
                onPress={() =>
                  onChange({
                    ...policy,
                    returnLabelPayerByReason: { ...policy.returnLabelPayerByReason, Other: value },
                  })
                }
              >
                <Text style={[styles.chipText, policy.returnLabelPayerByReason.Other === value && styles.chipTextOn]}>
                  {label}
                </Text>
              </Pressable>
            ))}
          </View>
        </>
      ) : null}
    </View>
  );
}

export function PolicyPreviewField({
  label,
  lead,
  leads,
  value,
  onChangeText,
  placeholder,
}: {
  label: string;
  lead?: string | null;
  leads?: readonly (string | null | undefined)[];
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
}) {
  const lines = [...(leads ?? []), lead].filter((line): line is string => Boolean(line));
  return (
    <View style={styles.previewWrap}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.previewBox}>
        {lines.map((line) => (
          <Text key={line} style={styles.bold}>
            {line}
          </Text>
        ))}
        <TextInput
          style={styles.previewInput}
          value={value}
          onChangeText={onChangeText}
          placeholder={lines.length ? "Type under this line." : placeholder}
          placeholderTextColor={theme.colors.placeholder}
          multiline
          textAlignVertical="top"
        />
      </View>
    </View>
  );
}

function ReasonGroup({
  title,
  reasons,
  policy,
  onChange,
}: {
  title: string;
  reasons: readonly ReturnLabelReason[];
  policy: SellerReturnLabelPolicy;
  onChange: (next: SellerReturnLabelPolicy) => void;
}) {
  const selected = reasonGroupSelection(policy.returnLabelPayerByReason, reasons);
  return (
    <View style={styles.reasonBlock}>
      <Text style={styles.reason}>{title}</Text>
      <View style={styles.choiceRow}>
        {(
          [
            ["buyer", "Buyer pays"],
            ["seller", "I pay"],
          ] as const
        ).map(([value, label]) => (
          <Pressable
            key={value}
            style={[styles.chip, selected === value && styles.chipOn]}
            onPress={() =>
              onChange({
                ...policy,
                returnLabelPayerByReason: applyReasonGroup(
                  policy.returnLabelPayerByReason,
                  reasons,
                  value satisfies ReasonLabelPayer
                ),
              })
            }
          >
            <Text style={[styles.chipText, selected === value && styles.chipTextOn]}>{label}</Text>
          </Pressable>
        ))}
      </View>
      {reasons.map((reason) => (
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
      ))}
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
  previewWrap: { marginTop: 8 },
  previewBox: {
    borderWidth: 1.5,
    borderColor: theme.colors.primary,
    borderRadius: 8,
    backgroundColor: "#fff",
    paddingHorizontal: 12,
    paddingTop: 10,
  },
  previewInput: {
    minHeight: 88,
    paddingVertical: 8,
    fontSize: 16,
    color: theme.colors.text,
  },
});
