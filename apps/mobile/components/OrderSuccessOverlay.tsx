import { Modal, View, Text, Pressable, Image, StyleSheet, useWindowDimensions } from "react-native";
import { theme } from "@/lib/theme";

type Props = {
  visible: boolean;
  onViewOrder: () => void;
  onKeepShopping: () => void;
};

/**
 * Full-screen purchase success overlay (~80% of viewport) shown after checkout.
 */
export function OrderSuccessOverlay({ visible, onViewOrder, onKeepShopping }: Props) {
  const { width, height } = useWindowDimensions();
  const panelWidth = Math.min(width * 0.88, 420);
  const panelHeight = Math.min(height * 0.8, 560);

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent>
      <View style={styles.backdrop}>
        <View style={[styles.panel, { width: panelWidth, minHeight: panelHeight }]}>
          <Text style={styles.title}>Thanks for Shopping Local!</Text>
          <Text style={styles.subtitle}>Your order was a success!</Text>

          <View style={styles.logoWrap}>
            <Image
              source={require("@/assets/images/nwc-community-logo.png")}
              style={styles.logo}
              resizeMode="contain"
              accessibilityLabel="Northwest Community logo"
            />
          </View>

          <View style={styles.actions}>
            <Pressable
              style={({ pressed }) => [styles.btn, pressed && styles.btnPressed]}
              onPress={onViewOrder}
              accessibilityRole="button"
              accessibilityLabel="View Order"
            >
              <Text style={styles.btnText}>View Order</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.btn, pressed && styles.btnPressed]}
              onPress={onKeepShopping}
              accessibilityRole="button"
              accessibilityLabel="Keep Shopping"
            >
              <Text style={styles.btnText}>Keep Shopping</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.45)",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  panel: {
    backgroundColor: "#fff",
    borderWidth: 4,
    borderColor: "#000",
    borderRadius: 4,
    paddingHorizontal: 28,
    paddingTop: 36,
    paddingBottom: 32,
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    fontFamily: theme.fonts.heading,
    fontSize: 26,
    lineHeight: 32,
    fontWeight: "700",
    color: "#000",
    textAlign: "center",
    marginBottom: 8,
  },
  subtitle: {
    fontFamily: theme.fonts.headingRegular,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "700",
    color: "#000",
    textAlign: "center",
    marginBottom: 8,
  },
  logoWrap: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 24,
    width: "100%",
  },
  logo: {
    width: 200,
    height: 200,
  },
  actions: {
    width: "100%",
    gap: 14,
  },
  btn: {
    width: "100%",
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 999,
    borderWidth: 3,
    borderColor: "#000",
    backgroundColor: "#fff",
    alignItems: "center",
  },
  btnPressed: {
    opacity: 0.85,
    backgroundColor: "#fafafa",
  },
  btnText: {
    fontSize: 18,
    fontWeight: "700",
    color: "#000",
  },
});
