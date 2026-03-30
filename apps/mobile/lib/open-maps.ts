import { Alert, Linking, Platform } from "react-native";

/**
 * Open a maps app for a free-text address. Tries several URL schemes because
 * `https://maps.apple.com/...` can reject on some iOS / Expo setups.
 */
export async function openAddressInMaps(address: string): Promise<void> {
  const trimmed = address.trim();
  if (!trimmed) return;

  const q = encodeURIComponent(trimmed);

  const urls =
    Platform.OS === "ios"
      ? [
          `maps://?q=${q}`,
          `http://maps.apple.com/?q=${q}`,
          `https://maps.apple.com/?q=${q}`,
          `https://www.google.com/maps/search/?api=1&query=${q}`,
        ]
      : Platform.OS === "android"
        ? [`geo:0,0?q=${q}`, `https://www.google.com/maps/search/?api=1&query=${q}`]
        : [`https://www.google.com/maps/search/?api=1&query=${q}`];

  for (const url of urls) {
    try {
      await Linking.openURL(url);
      return;
    } catch {
      /* try next */
    }
  }

  Alert.alert(
    "Could not open Maps",
    "Open your maps app and search for this address manually."
  );
}
