/** Default INW Community listing on the Apple App Store (US). */
export const DEFAULT_IOS_APP_STORE_URL =
  "https://apps.apple.com/us/app/inw-community/id6759624513";

function firstEnv(...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = process.env[k]?.trim();
    if (v) return v;
  }
  return undefined;
}

export function getIosAppStoreUrl(): string {
  return (
    firstEnv("NEXT_PUBLIC_IOS_APP_STORE_URL", "REFERRAL_IOS_APP_STORE_URL") ??
    DEFAULT_IOS_APP_STORE_URL
  );
}

/** Google Play listing URL when published; undefined if not configured. */
export function getAndroidPlayStoreUrl(): string | undefined {
  return firstEnv(
    "NEXT_PUBLIC_ANDROID_PLAY_STORE_URL",
    "REFERRAL_ANDROID_PLAY_STORE_URL",
  );
}
