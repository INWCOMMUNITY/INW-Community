import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "nwc_pending_referral_code_v1";

function normalizeRef(raw: string | null | undefined): string | null {
  const ref = raw?.trim();
  if (!ref || ref.length > 32) return null;
  if (!/^[a-zA-Z0-9]+$/.test(ref)) return null;
  return ref.toUpperCase();
}

/** Persist a referral code from deep link or signup route ?ref= */
export async function setPendingReferralCode(code: string): Promise<void> {
  const n = normalizeRef(code);
  if (!n) return;
  await AsyncStorage.setItem(STORAGE_KEY, n);
}

export async function getPendingReferralCode(): Promise<string | undefined> {
  const v = await AsyncStorage.getItem(STORAGE_KEY);
  return normalizeRef(v) ?? undefined;
}

export async function clearPendingReferralCode(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
}

function signupPathMatches(pathname: string): boolean {
  const p = pathname.replace(/\/$/, "") || "/";
  return (
    p === "/signup" ||
    p === "/signup/business" ||
    p === "/signup/seller"
  );
}

/**
 * If the URL is a signup link with ?ref=, store the code for the next /api/auth/signup call.
 * Handles https://www.inwcommunity.com/signup?ref=... and inwcommunity://signup?ref=...
 */
export async function captureReferralCodeFromUrl(urlString: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    return;
  }
  const ref = normalizeRef(url.searchParams.get("ref"));
  if (!ref) return;
  if (url.protocol === "inwcommunity:" && signupPathMatches(url.pathname)) {
    await setPendingReferralCode(ref);
    return;
  }
  if (url.protocol === "http:" || url.protocol === "https:") {
    if (signupPathMatches(url.pathname)) {
      await setPendingReferralCode(ref);
    }
  }
}
