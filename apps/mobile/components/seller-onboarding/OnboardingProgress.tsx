import { useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { theme } from "@/lib/theme";

export const SELLER_ONBOARDING_STEPS = [
  "Account",
  "Business",
  "Name and phone",
  "Subscribe",
  "Shipping",
  "Get paid",
  "Listings",
] as const;

const EARTH = theme.colors.earth;
const TAN = "#FDEDCC";

export function OnboardingProgress({ stepIndex }: { stepIndex: number }) {
  const current = Math.min(Math.max(stepIndex, 1), SELLER_ONBOARDING_STEPS.length);
  const label = SELLER_ONBOARDING_STEPS[current - 1];
  const [trackWidth, setTrackWidth] = useState(0);
  const fillWidth = trackWidth > 0 ? (trackWidth * current) / SELLER_ONBOARDING_STEPS.length : 0;

  return (
    <View
      style={styles.wrap}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 1, max: SELLER_ONBOARDING_STEPS.length, now: current, text: `Step ${current} of ${SELLER_ONBOARDING_STEPS.length}: ${label}` }}
    >
      <Text style={styles.label}>
        Step {current} of {SELLER_ONBOARDING_STEPS.length}
        <Text style={styles.labelMuted}> · {label}</Text>
      </Text>
      <View
        style={styles.track}
        onLayout={(event) => {
          const next = event.nativeEvent.layout.width;
          setTrackWidth((prev) => (prev === next ? prev : next));
        }}
      >
        <View style={[styles.fill, { width: fillWidth }]}>
          <View style={styles.stripes}>
            {Array.from({ length: 48 }).map((_, i) => (
              <View
                key={i}
                style={[styles.stripe, { backgroundColor: i % 2 === 0 ? EARTH : TAN }]}
              />
            ))}
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 16 },
  label: {
    marginBottom: 8,
    fontSize: 14,
    fontWeight: "600",
    color: theme.colors.heading,
    fontFamily: theme.fonts.heading,
  },
  labelMuted: {
    fontWeight: "400",
    color: EARTH,
    fontFamily: theme.fonts.body,
  },
  track: {
    height: 14,
    width: "100%",
    overflow: "hidden",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: EARTH,
    backgroundColor: TAN,
  },
  fill: {
    height: "100%",
    overflow: "hidden",
    borderRadius: 999,
    backgroundColor: EARTH,
  },
  stripes: {
    flexDirection: "row",
    height: "100%",
  },
  stripe: { width: 8, height: "100%" },
});
