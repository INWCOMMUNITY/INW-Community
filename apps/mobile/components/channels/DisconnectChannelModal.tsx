import React from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { theme } from "@/lib/theme";
import { listingsLabel, overlapCounts } from "@/lib/disconnect-inw-items";

export type DisconnectPrompt = {
  conn: {
    linkedListings: number;
    linkedOnlyThisChannel?: number;
    linkedAlsoOnOthers?: number;
  };
  name: string;
  step: "choose" | "confirmExclusive" | "confirmAll";
};

type Props = {
  prompt: DisconnectPrompt | null;
  busy: boolean;
  onClose: () => void;
  onKeepOnInw: () => void;
  onRequestExclusive: () => void;
  onRequestDeleteAll: () => void;
  onConfirmExclusive: () => void;
  onConfirmDeleteAll: () => void;
  onDisconnectNoLinks: () => void;
};

function OutcomeButton({
  title,
  detail,
  onPress,
  disabled,
  variant,
}: {
  title: string;
  detail: string;
  onPress: () => void;
  disabled: boolean;
  variant: "keep" | "mixed" | "danger" | "cancel";
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.outcome,
        variant === "keep" && styles.outcomeKeep,
        variant === "mixed" && styles.outcomeMixed,
        variant === "danger" && styles.outcomeDanger,
        variant === "cancel" && styles.outcomeCancel,
        pressed && { opacity: 0.85 },
        disabled && { opacity: 0.5 },
      ]}
    >
      <Text
        style={[
          styles.outcomeTitle,
          (variant === "mixed" || variant === "danger") && styles.outcomeTitleOnColor,
        ]}
      >
        {title}
      </Text>
      <Text
        style={[
          styles.outcomeDetail,
          (variant === "mixed" || variant === "danger") && styles.outcomeDetailOnColor,
        ]}
      >
        {detail}
      </Text>
    </Pressable>
  );
}

export function DisconnectChannelModal({
  prompt,
  busy,
  onClose,
  onKeepOnInw,
  onRequestExclusive,
  onRequestDeleteAll,
  onConfirmExclusive,
  onConfirmDeleteAll,
  onDisconnectNoLinks,
}: Props) {
  if (!prompt) return null;

  const { conn, name, step } = prompt;
  const { linked, onlyThis, alsoOthers } = overlapCounts(conn);
  const hasLinks = linked > 0;
  const showExclusive = onlyThis > 0 && alsoOthers > 0;

  const title =
    step === "confirmExclusive"
      ? "Keep listings on other stores?"
      : step === "confirmAll"
        ? "Delete all from INW Community?"
        : `Disconnect ${name}?`;

  const body =
    step === "confirmExclusive"
      ? `This deletes ${listingsLabel(onlyThis)} from INW that ${onlyThis === 1 ? "is" : "are"} only linked to ${name}. ${listingsLabel(alsoOthers)} also on other connected stores will stay on INW.\n\nListings on ${name} and your other stores are not removed. After disconnecting, you are responsible for inventory on every channel (see Terms of Service).`
      : step === "confirmAll"
        ? alsoOthers > 0
          ? `This permanently removes ${listingsLabel(linked)} from your INW storefront. ${listingsLabel(alsoOthers)} ${alsoOthers === 1 ? "is" : "are"} also linked to other connected stores — those INW listings will be deleted and INW will stop tracking them there.\n\nListings on ${name} and other marketplaces stay live. After disconnecting, you are responsible for inventory on every channel (see Terms of Service).`
          : `This permanently removes ${listingsLabel(linked)} from your INW storefront only. None of them are linked to another connected store. Listings on ${name} stay as they are.\n\nAfter disconnecting, you are responsible for inventory and sales on ${name} and any other channel (see Terms of Service).`
        : hasLinks
          ? `You have ${listingsLabel(linked)} tied to ${name}. Sync will stop in both directions. Your listings on ${name} are not removed by INW.\n\nNWC is not responsible for inventory, oversells, or other business effects after you disconnect (see Terms of Service).`
          : `Your ${name} account will disconnect from INW Community. Any items you add later on INW will not sync to ${name} until you connect again.`;

  return (
    <Modal visible animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <Text style={styles.title}>{title}</Text>
          <ScrollView style={styles.scroll} bounces={false}>
            <Text style={styles.body}>{body}</Text>
            {step === "choose" && hasLinks ? (
              <View style={styles.bullets}>
                <Text style={styles.bullet}>
                  • {listingsLabel(linked)} linked to {name}
                </Text>
                <Text style={styles.bullet}>
                  {alsoOthers > 0
                    ? `• ${listingsLabel(alsoOthers)} also linked to another connected store`
                    : "• None of these listings are linked to another connected store"}
                </Text>
                {onlyThis > 0 && alsoOthers > 0 ? (
                  <Text style={styles.bullet}>
                    • {listingsLabel(onlyThis)} only on {name}
                  </Text>
                ) : null}
              </View>
            ) : null}
          </ScrollView>

          {busy ? (
            <View style={styles.busyRow}>
              <ActivityIndicator color={theme.colors.primary} />
              <Text style={styles.busyText}>Disconnecting…</Text>
            </View>
          ) : step === "confirmExclusive" ? (
            <>
              <OutcomeButton
                title="Keep other-store listings"
                detail={`Delete ${listingsLabel(onlyThis)} only on ${name}. Keep ${listingsLabel(alsoOthers)} on other stores.`}
                onPress={onConfirmExclusive}
                disabled={busy}
                variant="mixed"
              />
              <OutcomeButton
                title="Cancel"
                detail="Leave this store connected."
                onPress={onClose}
                disabled={busy}
                variant="cancel"
              />
            </>
          ) : step === "confirmAll" ? (
            <>
              <OutcomeButton
                title="Delete all from INW"
                detail="Remove these INW listings. Marketplace listings stay live."
                onPress={onConfirmDeleteAll}
                disabled={busy}
                variant="danger"
              />
              <OutcomeButton
                title="Cancel"
                detail="Leave this store connected."
                onPress={onClose}
                disabled={busy}
                variant="cancel"
              />
            </>
          ) : hasLinks ? (
            <>
              <Text style={styles.chooseLabel}>Choose what happens on INW:</Text>
              <OutcomeButton
                title="Keep all on INW"
                detail={`Disconnect only. All ${listingsLabel(linked)} stay on your INW storefront and stay linked to any other stores.`}
                onPress={onKeepOnInw}
                disabled={busy}
                variant="keep"
              />
              {showExclusive ? (
                <OutcomeButton
                  title="Keep listings on other stores"
                  detail={`Delete ${listingsLabel(onlyThis)} that ${onlyThis === 1 ? "is" : "are"} only on ${name}. Keep ${listingsLabel(alsoOthers)} that ${alsoOthers === 1 ? "is" : "are"} also on other connected stores.`}
                  onPress={onRequestExclusive}
                  disabled={busy}
                  variant="mixed"
                />
              ) : null}
              <OutcomeButton
                title="Delete all from INW"
                detail={
                  alsoOthers > 0
                    ? `Remove all ${listingsLabel(linked)} from INW, including ${listingsLabel(alsoOthers)} that ${alsoOthers === 1 ? "is" : "are"} also on other stores. Marketplace listings stay live, but INW will stop tracking those items.`
                    : `Remove all ${listingsLabel(linked)} from your INW storefront. Listings on ${name} stay as they are.`
                }
                onPress={onRequestDeleteAll}
                disabled={busy}
                variant="danger"
              />
              <OutcomeButton
                title="Cancel"
                detail="Leave this store connected."
                onPress={onClose}
                disabled={busy}
                variant="cancel"
              />
            </>
          ) : (
            <>
              <OutcomeButton
                title="Disconnect"
                detail={`Stop syncing with ${name}.`}
                onPress={onDisconnectNoLinks}
                disabled={busy}
                variant="mixed"
              />
              <OutcomeButton
                title="Cancel"
                detail="Leave this store connected."
                onPress={onClose}
                disabled={busy}
                variant="cancel"
              />
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    padding: 16,
  },
  sheet: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 20,
    maxHeight: "90%",
    borderWidth: 2,
    borderColor: theme.colors.primary,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    color: theme.colors.heading,
    marginBottom: 10,
  },
  scroll: {
    maxHeight: 220,
    marginBottom: 12,
  },
  body: {
    fontSize: 14,
    color: "#555",
    lineHeight: 20,
  },
  bullets: {
    marginTop: 12,
    gap: 4,
  },
  bullet: {
    fontSize: 14,
    color: "#333",
    lineHeight: 20,
  },
  chooseLabel: {
    fontSize: 14,
    fontWeight: "700",
    color: theme.colors.heading,
    marginBottom: 8,
  },
  busyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
  },
  busyText: {
    fontSize: 14,
    fontWeight: "600",
    color: theme.colors.primary,
  },
  outcome: {
    borderWidth: 2,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 8,
  },
  outcomeKeep: {
    borderColor: theme.colors.primary,
    backgroundColor: "#fff",
  },
  outcomeMixed: {
    borderColor: theme.colors.primary,
    backgroundColor: theme.colors.primary,
  },
  outcomeDanger: {
    borderColor: "#b91c1c",
    backgroundColor: "#b91c1c",
  },
  outcomeCancel: {
    borderColor: "#e5e7eb",
    backgroundColor: "#fff",
  },
  outcomeTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: theme.colors.primary,
  },
  outcomeTitleOnColor: {
    color: "#fff",
  },
  outcomeDetail: {
    fontSize: 12,
    color: "#555",
    marginTop: 2,
    lineHeight: 16,
  },
  outcomeDetailOnColor: {
    color: "rgba(255,255,255,0.9)",
  },
});
