import { useEffect, useState } from "react";
import {
  View,
  Text,
  Pressable,
  Modal,
  Platform,
  StyleSheet,
} from "react-native";
import DateTimePicker, {
  DateTimePickerAndroid,
} from "@react-native-community/datetimepicker";
import { theme } from "@/lib/theme";
import { androidDateTimePickerThemeProps } from "@/lib/datetimepicker-android";

function stripTime(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function localDayFromIso(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return stripTime(d);
}

function localDayEndToIso(day: Date): string {
  const end = new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    23,
    59,
    59,
    999
  );
  return end.toISOString();
}

function formatDateDisplay(d: Date): string {
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

type Props = {
  expiresAtIso: string | null | undefined;
  onCommit: (iso: string | null) => void;
  disabled?: boolean;
  label?: string;
  hint?: string;
};

/**
 * Expiration date for coupons: Android calendar dialog, iOS spinner sheet (same pattern as event poster).
 */
export function CouponExpiryDatePickerField({
  expiresAtIso,
  onCommit,
  disabled = false,
  label = "Expires (optional)",
  hint = "Last day this offer appears in the coupon book. Tap to choose a date, or clear for no expiration.",
}: Props) {
  const [showIosPicker, setShowIosPicker] = useState(false);
  const [iosDraft, setIosDraft] = useState<Date>(() => {
    const x = localDayFromIso(expiresAtIso);
    return x ?? stripTime(new Date());
  });

  useEffect(() => {
    const x = localDayFromIso(expiresAtIso);
    if (x) setIosDraft(x);
  }, [expiresAtIso]);

  const displayDay = localDayFromIso(expiresAtIso);

  const openPicker = () => {
    if (disabled) return;
    const initial = displayDay ?? stripTime(new Date());
    setIosDraft(initial);
    if (Platform.OS === "android") {
      DateTimePickerAndroid.open({
        ...androidDateTimePickerThemeProps,
        value: initial,
        mode: "date",
        onChange: (event, date) => {
          if (event.type === "set" && date) {
            onCommit(localDayEndToIso(stripTime(date)));
          }
        },
      });
    } else {
      setShowIosPicker(true);
    }
  };

  const commitIos = () => {
    onCommit(localDayEndToIso(stripTime(iosDraft)));
    setShowIosPicker(false);
  };

  const hasExpiration = Boolean(expiresAtIso);

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.hint}>{hint}</Text>
      <Pressable
        style={[styles.dateBar, disabled && styles.disabled]}
        onPress={openPicker}
        disabled={disabled}
      >
        <Text style={styles.dateBarText}>
          {displayDay ? formatDateDisplay(displayDay) : "No expiration"}
        </Text>
        <Text style={styles.dateBarHint}>Tap to choose</Text>
      </Pressable>
      <Pressable
        style={[styles.clearBtn, (disabled || !hasExpiration) && styles.disabled]}
        onPress={() => !disabled && hasExpiration && onCommit(null)}
        disabled={disabled || !hasExpiration}
      >
        <Text style={styles.clearBtnText}>Clear expiration</Text>
      </Pressable>

      {Platform.OS === "ios" && (
        <Modal visible={showIosPicker} transparent animationType="slide">
          <Pressable style={styles.modalOverlay} onPress={() => setShowIosPicker(false)}>
            <Pressable style={styles.pickerModal} onPress={(e) => e.stopPropagation()}>
              <DateTimePicker
                value={iosDraft}
                mode="date"
                display="spinner"
                onChange={(_, d) => {
                  if (d) setIosDraft(stripTime(d));
                }}
                textColor={theme.colors.primary}
              />
              <Pressable style={styles.savePickerBtn} onPress={commitIos}>
                <Text style={styles.savePickerBtnText}>Save</Text>
              </Pressable>
            </Pressable>
          </Pressable>
        </Modal>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { marginBottom: 4 },
  label: {
    fontSize: 12,
    fontWeight: "600",
    color: "#666",
    marginBottom: 4,
  },
  hint: {
    fontSize: 12,
    color: "#888",
    marginBottom: 8,
    lineHeight: 17,
  },
  dateBar: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  dateBarText: {
    fontSize: 16,
    color: theme.colors.heading,
    flex: 1,
  },
  dateBarHint: {
    fontSize: 12,
    color: "#999",
  },
  clearBtn: {
    alignSelf: "flex-start",
    marginBottom: 12,
  },
  clearBtnText: {
    fontSize: 14,
    color: theme.colors.primary,
    fontWeight: "600",
  },
  disabled: { opacity: 0.5 },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  pickerModal: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    paddingBottom: 34,
  },
  savePickerBtn: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 16,
  },
  savePickerBtnText: {
    color: theme.colors.buttonText,
    fontSize: 18,
    fontWeight: "600",
  },
});
