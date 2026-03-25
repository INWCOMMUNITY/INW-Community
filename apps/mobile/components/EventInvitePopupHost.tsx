import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AppState, AppStateStatus } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { usePathname } from "expo-router";
import { useAuth } from "@/contexts/AuthContext";
import { useEventInvitePopupSuppression } from "@/contexts/EventInvitePopupSuppressionContext";
import { apiGet, apiPatch } from "@/lib/api";
import { EventInvitePopup, type EventInvitePopupInvite } from "@/components/EventInvitePopup";

/** Routes where an interrupting invite popup would clash with checkout, web flows, or heavy forms. */
function routeSuppressesEventInvitePopup(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  const p = pathname.toLowerCase().replace(/\/$/, "");
  const firstSeg = p.split("/").filter(Boolean)[0] ?? "";
  return (
    firstSeg === "cart" ||
    p.startsWith("/web") ||
    p.startsWith("web") ||
    p.startsWith("/subscribe") ||
    p.startsWith("subscribe") ||
    p.startsWith("/profile-edit") ||
    p.startsWith("profile-edit") ||
    p.startsWith("/sponsor-business") ||
    p.startsWith("sponsor-business") ||
    p.startsWith("/scanner") ||
    p.startsWith("scanner") ||
    p.includes("/seller-hub/store/new") ||
    p.includes("/seller-hub/store/edit") ||
    p.startsWith("/coupons/") ||
    p.startsWith("coupons/") ||
    p.startsWith("/rewards/") ||
    p.startsWith("rewards/") ||
    p.startsWith("/redeemed-rewards") ||
    p.startsWith("redeemed-rewards") ||
    p.startsWith("/policies") ||
    p.startsWith("policies") ||
    p.startsWith("/messages") ||
    p.startsWith("messages") ||
    p.startsWith("/manage-subscription") ||
    p.startsWith("manage-subscription")
  );
}

const DISMISS_KEY = "event_invite_popup_dismissed_ids";

async function getDismissed(): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(DISMISS_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

async function dismissId(id: string) {
  const dismissed = await getDismissed();
  dismissed.add(id);
  await AsyncStorage.setItem(DISMISS_KEY, JSON.stringify([...dismissed]));
}

interface PendingInviteApi {
  id: string;
  status: string;
  event: { title: string; slug: string };
  inviter: { id: string; firstName: string; lastName: string };
}

export function EventInvitePopupHost() {
  const { member } = useAuth();
  const pathname = usePathname();
  const { formOrModalOpenCount } = useEventInvitePopupSuppression();
  const [invite, setInvite] = useState<EventInvitePopupInvite | null>(null);
  const [visible, setVisible] = useState(false);
  const [responding, setResponding] = useState(false);
  const appState = useRef(AppState.currentState);

  const pickInvite = useCallback(async () => {
    if (!member?.id) {
      setVisible(false);
      setInvite(null);
      return;
    }
    if (formOrModalOpenCount > 0 || routeSuppressesEventInvitePopup(pathname)) {
      setVisible(false);
      setInvite(null);
      return;
    }
    try {
      const data = await apiGet<{ invites: PendingInviteApi[] }>(
        "/api/me/event-invites?scope=pending"
      );
      const pending = data?.invites ?? [];
      const dismissed = await getDismissed();
      const next = pending.find((i) => i.status === "pending" && !dismissed.has(i.id));
      if (next) {
        setInvite({
          id: next.id,
          event: next.event,
          inviter: next.inviter,
        });
        setVisible(true);
      } else {
        setVisible(false);
        setInvite(null);
      }
    } catch (e) {
      if (__DEV__) {
        console.warn("[EventInvitePopupHost] pending invites fetch failed", e);
      }
      setVisible(false);
      setInvite(null);
    }
  }, [member?.id, formOrModalOpenCount, pathname]);

  useEffect(() => {
    if (!member?.id) return;
    pickInvite();
    const interval = setInterval(pickInvite, 45000);
    const sub = AppState.addEventListener("change", (next: AppStateStatus) => {
      if (appState.current.match(/inactive|background/) && next === "active") {
        pickInvite();
      }
      appState.current = next;
    });
    return () => {
      clearInterval(interval);
      sub.remove();
    };
  }, [member?.id, pickInvite]);

  /** React immediately to suppression; when it lifts, re-poll on the next tick to avoid effect ordering races. */
  useEffect(() => {
    if (formOrModalOpenCount > 0 || routeSuppressesEventInvitePopup(pathname)) {
      setVisible(false);
      setInvite(null);
      return;
    }
    if (!member?.id) return;
    const t = setTimeout(() => {
      void pickInvite();
    }, 0);
    return () => clearTimeout(t);
  }, [member?.id, formOrModalOpenCount, pathname, pickInvite]);

  const handleClose = () => {
    if (invite) {
      dismissId(invite.id).catch(() => {});
    }
    setVisible(false);
    setInvite(null);
  };

  const handleRespond = async (status: "accepted" | "maybe" | "declined") => {
    if (!invite) return;
    setResponding(true);
    try {
      await apiPatch(`/api/event-invites/${invite.id}`, { status });
      setVisible(false);
      setInvite(null);
      await pickInvite();
    } catch (e) {
      const msg =
        e && typeof e === "object" && "error" in e && typeof (e as { error: unknown }).error === "string"
          ? (e as { error: string }).error
          : "Could not update this invite. Check your connection and try again.";
      Alert.alert("Something went wrong", msg);
    } finally {
      setResponding(false);
    }
  };

  return (
    <EventInvitePopup
      visible={visible}
      invite={invite}
      onClose={handleClose}
      onRespond={handleRespond}
      responding={responding}
    />
  );
}
