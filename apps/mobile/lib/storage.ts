/**
 * Token storage - in-memory + SecureStore (native) or AsyncStorage (web).
 * In-memory ensures token is available within the same session even if persistent storage fails.
 */

import { Platform } from "react-native";

const TOKEN_KEY = "nwc_token";

let memoryToken: string | null = null;

async function readFromStorage(): Promise<string | null> {
  try {
    if (Platform.OS === "web") {
      const AsyncStorage = (await import("@react-native-async-storage/async-storage")).default;
      return await AsyncStorage.getItem(TOKEN_KEY);
    }
    const SecureStore = await import("expo-secure-store");
    return await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    return null;
  }
}

async function writeToStorage(token: string): Promise<void> {
  try {
    if (Platform.OS === "web") {
      const AsyncStorage = (await import("@react-native-async-storage/async-storage")).default;
      await AsyncStorage.setItem(TOKEN_KEY, token);
      return;
    }
    const SecureStore = await import("expo-secure-store");
    await SecureStore.setItemAsync(TOKEN_KEY, token);
  } catch (e) {
    console.warn("[storage] Failed to persist token", e);
  }
}

async function removeFromStorage(): Promise<void> {
  try {
    if (Platform.OS === "web") {
      const AsyncStorage = (await import("@react-native-async-storage/async-storage")).default;
      await AsyncStorage.removeItem(TOKEN_KEY);
      return;
    }
    const SecureStore = await import("expo-secure-store");
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch (e) {
    console.warn("[storage] Failed to clear token", e);
  }
}

export async function getToken(): Promise<string | null> {
  // Return in-memory first - guarantees session continuity
  if (memoryToken) return memoryToken;
  const stored = await readFromStorage();
  if (stored) memoryToken = stored;
  return stored;
}

export async function setToken(token: string): Promise<void> {
  memoryToken = token;
  await writeToStorage(token);
}

export async function clearToken(): Promise<void> {
  memoryToken = null;
  await removeFromStorage();
}
