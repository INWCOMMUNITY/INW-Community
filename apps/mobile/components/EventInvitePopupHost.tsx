import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AppState, AppStateStatus } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuth } from "@/contexts/AuthContext";
import { apiGet, apiPatch } from "@/lib/api";
import { EventInvitePopup, type EventInvitePopupInvite } from "@/components/EventInvitePopup";

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
    } catch {
      // ignore
    }
  }, [member?.id]);

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
