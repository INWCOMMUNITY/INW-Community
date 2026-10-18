import { Pressable, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { switchIosBackgroundColor, switchThumbColor, switchTrackColor, theme } from "@/lib/theme";
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
          <View style={styles.faultRow}>
            <ReasonColumn title="Buyer Fault" reasons={BUYER_FAULT_REASONS} policy={policy} onChange={onChange} />
            <View style={styles.faultDivider} />
            <ReasonColumn title="Seller Fault" reasons={SELLER_FAULT_REASONS} policy={policy} onChange={onChange} />
          </View>
          <Text style={styles.faultTitle}>Other</Text>
          <View style={styles.payerRow}>
            {(
              [
                ["buyer", "Buyer pays"],
                ["seller", "I pay"],
                ["later", "Decide later"],
              ] as const
            ).map(([value, label]) => (
              <Pressable
                key={value}
                style={[styles.payerBtn, styles.payerBtnFlex, policy.returnLabelPayerByReason.Other === value && styles.payerBtnOn]}
                onPress={() =>
                  onChange({
                    ...policy,
                    returnLabelPayerByReason: { ...policy.returnLabelPayerByReason, Other: value },
                  })
                }
              >
                <Text style={[styles.payerBtnText, policy.returnLabelPayerByReason.Other === value && styles.payerBtnTextOn]}>
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

function ReasonColumn({
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
  const setGroup = (payer: ReasonLabelPayer) =>
    onChange({
      ...policy,
      returnLabelPayerByReason: applyReasonGroup(policy.returnLabelPayerByReason, reasons, payer),
    });
  return (
    <View style={styles.faultCol}>
      <Text style={styles.faultTitle}>{title}</Text>
      {(
        [
          ["buyer", "Buyer pays"],
          ["seller", "I pay"],
        ] as const
      ).map(([value, label]) => (
        <View key={value} style={styles.toggleRow}>
          <Switch
            value={selected === value}
            onValueChange={(on) => {
              if (on) setGroup(value);
            }}
            trackColor={switchTrackColor()}
            thumbColor={switchThumbColor(selected === value)}
            ios_backgroundColor={switchIosBackgroundColor}
          />
          <Text style={styles.toggleLabel}>{label}</Text>
        </View>
      ))}
      <View style={styles.bulkLine} />
      {reasons.map((reason) => (
        <View key={reason} style={styles.reasonItem}>
          <Text style={styles.reason}>{reason}</Text>
          <View style={styles.payerRow}>
            {(
              [
                ["buyer", "Buyer"],
                ["seller", "I pay"],
              ] as const
            ).map(([value, label]) => (
              <Pressable
                key={value}
                style={[styles.payerBtn, styles.payerBtnFlex, policy.returnLabelPayerByReason[reason] === value && styles.payerBtnOn]}
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
                    styles.payerBtnText,
                    policy.returnLabelPayerByReason[reason] === value && styles.payerBtnTextOn,
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
  label: { fontSize: 16, fontWeight: "600", color: theme.colors.heading, marginBottom: 8 },
  hint: { fontSize: 13, color: "#6b7280" },
  bold: { fontSize: 15, fontWeight: "700", color: "#111827", marginBottom: 4 },
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
  faultRow: { flexDirection: "row", alignItems: "stretch", marginTop: 8 },
  faultCol: { flex: 1, minWidth: 0, gap: 8 },
  faultDivider: { width: 1, alignSelf: "stretch", backgroundColor: "#d1d5db", marginHorizontal: 10 },
  faultTitle: { fontSize: 18, fontWeight: "700", color: "#111827", marginTop: 12 },
  bulkLine: { height: 1, backgroundColor: "#d1d5db", marginVertical: 4 },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  toggleLabel: { flex: 1, fontSize: 13, color: "#111827" },
  payerRow: { flexDirection: "row", gap: 4 },
  payerBtn: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 4,
    backgroundColor: "#fff",
    alignItems: "center",
  },
  payerBtnFlex: { flex: 1 },
  payerBtnOn: { borderColor: theme.colors.primary, backgroundColor: theme.colors.cream },
  payerBtnText: { fontSize: 11, color: "#374151", textAlign: "center" },
  payerBtnTextOn: { color: theme.colors.primary, fontWeight: "700" },
  reasonItem: { gap: 4, marginTop: 2 },
  reason: { fontSize: 13, lineHeight: 18, color: "#111827" },
  previewWrap: { marginTop: 0 },
  previewBox: {
    borderWidth: 2,
    borderColor: theme.colors.primary,
    borderRadius: 8,
    backgroundColor: "#fff",
    padding: 12,
    minHeight: 100,
  },
  previewInput: {
    minHeight: 100,
    paddingVertical: 0,
    fontSize: 15,
    color: theme.colors.text,
  },
});
