"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
} from "react";
import { getToken, clearToken } from "@/lib/api";
import { apiGet } from "@/lib/api";
import type { SubscriptionPlan } from "@/lib/auth";

export interface Member {
  id?: string;
  firstName: string;
  lastName: string;
  email: string;
  profilePhotoUrl: string | null;
  bio?: string | null;
  city?: string | null;
  points?: number;
  isSubscriber?: boolean;
  subscriptionPlan?: SubscriptionPlan | null;
  subscriptions?: { plan: string; status: string }[];
  signupIntent?: "resident" | "business" | "seller" | null;
}

interface AuthContextValue {
  member: Member | null;
  subscriptionPlan: SubscriptionPlan | null;
  loading: boolean;
  setMember: (m: Member | null) => void;
  refreshMember: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [member, setMember] = useState<Member | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshMember = useCallback(async () => {
    const token = await getToken();
    if (!token) {
      setMember(null);
      return;
    }
    try {
      const m = await apiGet<Member>("/api/me");
      setMember(m);
    } catch {
      setMember(null);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = await getToken();
      if (!token) {
        if (!cancelled) {
          setMember(null);
          setLoading(false);
        }
        return;
      }
      try {
        const m = await apiGet<Member>("/api/me");
        if (!cancelled) setMember(m);
      } catch {
        if (!cancelled) setMember(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSignOut = useCallback(async () => {
    await clearToken();
    setMember(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      member,
      subscriptionPlan: member?.subscriptionPlan ?? null,
      loading,
      setMember,
      refreshMember,
      signOut: handleSignOut,
    }),
    [member, loading, refreshMember, handleSignOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
