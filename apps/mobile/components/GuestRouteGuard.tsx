import { useEffect } from "react";
import { useRouter, useSegments } from "expo-router";
import { useAuth } from "@/contexts/AuthContext";
import { shouldBlockGuestMobileRoute } from "@/lib/guest-access";

/**
 * Redirects guests away from denylisted stacks (friends, groups, hubs, messages, etc.).
 */
export function GuestRouteGuard({ children }: { children: React.ReactNode }) {
  const segments = useSegments();
  const { member, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (member) return;
    if (!shouldBlockGuestMobileRoute(segments)) return;
    router.replace("/(auth)/login" as never);
  }, [loading, member, router, segments]);

  return <>{children}</>;
}
