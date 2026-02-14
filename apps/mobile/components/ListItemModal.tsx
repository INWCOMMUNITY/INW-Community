import {
  Modal,
  StyleSheet,
  View,
  Text,
  Pressable,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { WebView } from "react-native-webview";
import { theme } from "@/lib/theme";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");
const LIST_ITEM_URL = `${siteBase}/resale-hub/list`;

interface ListItemModalProps {
  visible: boolean;
  onClose: () => void;
}

export function ListItemModal({ visible, onClose }: ListItemModalProps) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle={Platform.OS === "ios" ? "pageSheet" : "overFullScreen"}
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>List an Item</Text>
          <Pressable
            onPress={onClose}
            style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.7 }]}
          >
            <Ionicons name="close" size={24} color="#fff" />
          </Pressable>
        </View>
        <WebView
          source={{ uri: LIST_ITEM_URL }}
          style={styles.webview}
          onNavigationStateChange={(nav) => {
            if (nav.url.includes("order-success") || nav.url.includes("listings")) {
              onClose();
            }
          }}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    paddingTop: 48,
    backgroundColor: theme.colors.primary,
    borderBottomWidth: 2,
    borderBottomColor: "#000",
  },
  title: {
    fontSize: 18,
    fontWeight: "600",
    color: "#fff",
  },
  closeBtn: {
    padding: 4,
  },
  webview: {
    flex: 1,
  },
});
