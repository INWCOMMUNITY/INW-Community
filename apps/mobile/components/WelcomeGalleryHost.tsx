/**
 * Global host for the first-launch welcome gallery. Auto-opens the gallery once
 * (gated by AsyncStorage) and lets the community side menu re-open it via
 * WelcomeGalleryContext. Mounted near the root of the app tree.
 */
import { useEffect, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { useAuth } from "@/contexts/AuthContext";
import { useWelcomeGallery } from "@/contexts/WelcomeGalleryContext";
import { WelcomeGallery } from "@/components/WelcomeGallery";

const WELCOME_SEEN_KEY = "nwc_welcome_gallery_seen_v1";

export function WelcomeGalleryHost() {
  const router = useRouter();
  const { member } = useAuth();
  const gallery = useWelcomeGallery();

  useEffect(() => {
    if (!gallery) return;
    let cancelled = false;
    AsyncStorage.getItem(WELCOME_SEEN_KEY)
      .then((v) => {
        if (!cancelled && v !== "1") gallery.openWelcome();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // Run once on mount; openWelcome is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const markSeen = useCallback(() => {
    AsyncStorage.setItem(WELCOME_SEEN_KEY, "1").catch(() => {});
  }, []);

  const handleClose = useCallback(() => {
    markSeen();
    gallery?.closeWelcome();
  }, [gallery, markSeen]);

  const handleSignUp = useCallback(() => {
    markSeen();
    gallery?.closeWelcome();
    (router.push as (href: string) => void)("/signup-resident");
  }, [gallery, markSeen, router]);

  if (!gallery) return null;

  return (
    <WelcomeGallery
      visible={gallery.visible}
      isSignedIn={!!member}
      onClose={handleClose}
      onSignUp={handleSignUp}
    />
  );
}
