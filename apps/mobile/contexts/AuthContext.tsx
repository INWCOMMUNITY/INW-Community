"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
} from "react";
import { getToken, clearToken, setOnTokenCleared } from "@/lib/api";
import { apiGet } from "@/lib/api";
import type { SubscriptionPlan } from "@/lib/auth";

export interface Member {
  id?: string;
  firstName: string;
  lastName: string;
  email: string;
  /** From GET /api/me — false until the member opens the verification link in email. */
  emailVerified?: boolean;
  profilePhotoUrl: string | null;
  bio?: string | null;
  city?: string | null;
  points?: number;
  isSubscriber?: boolean;
  /** Resident Subscribe plan only — NWC Resale Hub (not Business/Seller alone). */
  hasResaleHubAccess?: boolean;
  /** Paid Business/Seller or admin-assigned business (see /api/me). */
  hasBusinessHubAccess?: boolean;
  /** Subscribe, Business, or Seller — coupons + 2× points on purchases/scans */
  hasPaidSubscription?: boolean;
  subscriptionPlan?: SubscriptionPlan | null;
  subscriptions?: { plan: string; status: string }[];
  signupIntent?: "resident" | "business" | "seller" | null;
}

function thrownStatus(e: unknown): number | undefined {
  if (e && typeof e === "object" && "status" in e) {
    const s = (e as { status: unknown }).status;
    return typeof s === "number" ? s : undefined;
  }
  return undefined;
}

function thrownMessage(e: unknown): string {
  if (e && typeof e === "object" && "error" in e) {
    const msg = (e as { error: unknown }).error;
    if (typeof msg === "string" && msg.trim()) return msg;
  }
  return "Could not load your profile. Check your connection and try again.";
}

/** True when the session is invalid or signed out (not transient network/server errors). */
function isAuthSessionError(e: unknown): boolean {
  return thrownStatus(e) === 401;
}

interface AuthContextValue {
  member: Member | null;
  subscriptionPlan: SubscriptionPlan | null;
  loading: boolean;
  /** Set when /api/me fails but the session may still be valid (offline, 5xx). Cleared on success. */
  profileSyncError: string | null;
  clearProfileSyncError: () => void;
  setMember: (m: Member | null) => void;
  refreshMember: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [member, setMember] = useState<Member | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileSyncError, setProfileSyncError] = useState<string | null>(null);

  const clearProfileSyncError = useCallback(() => {
    setProfileSyncError(null);
  }, []);

  const refreshMember = useCallback(async () => {
    const token = await getToken();
    if (!token) {
      setMember(null);
      setProfileSyncError(null);
      return;
    }
    try {
      const m = await apiGet<Member>("/api/me");
      setMember(m);
      setProfileSyncError(null);
    } catch (e) {
      if (isAuthSessionError(e)) {
        setMember(null);
        setProfileSyncError(null);
      } else {
        setProfileSyncError(thrownMessage(e));
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = await getToken();
      if (!token) {
        if (!cancelled) {
          setMember(null);
          setProfileSyncError(null);
          setLoading(false);
        }
        return;
      }
      try {
        const m = await apiGet<Member>("/api/me");
        if (!cancelled) {
          setMember(m);
          setProfileSyncError(null);
        }
      } catch (e) {
        if (!cancelled) {
          if (isAuthSessionError(e)) {
            setMember(null);
            setProfileSyncError(null);
          } else {
            setProfileSyncError(thrownMessage(e));
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setOnTokenCleared(() => {
      setMember(null);
      setProfileSyncError(null);
    });
    return () => setOnTokenCleared(null);
  }, []);

  const handleSignOut = useCallback(async () => {
    await clearToken();
    setMember(null);
    setProfileSyncError(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      member,
      subscriptionPlan: member?.subscriptionPlan ?? null,
      loading,
      profileSyncError,
      clearProfileSyncError,
      setMember,
      refreshMember,
      signOut: handleSignOut,
    }),
    [member, loading, profileSyncError, clearProfileSyncError, refreshMember, handleSignOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
