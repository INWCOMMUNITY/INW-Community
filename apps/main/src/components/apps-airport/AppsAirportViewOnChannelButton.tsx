"use client";

import { useState } from "react";
import { APPS_AIRPORT_ROW_ACTION_BTN_CLASS } from "@/components/apps-airport/apps-airport-row-action-btn";
import { IonIcon } from "@/components/IonIcon";

/** Per-row "View On {Party}" icon button (Sync Airport hubs). */
export function AppsAirportViewOnChannelButton({
  label,
  icon,
  href,
  onClick,
  unavailableLabel = "Not live yet",
}: {
  label: string;
  icon: string;
  href?: string | null;
  onClick?: () => void | Promise<void>;
  unavailableLabel?: string;
}) {
  const [busy, setBusy] = useState(false);
  const canOpen = Boolean(href) || Boolean(onClick);

  if (!canOpen) {
    return <span className="text-xs text-neutral-500">{unavailableLabel}</span>;
  }

  async function handleClick() {
    if (onClick) {
      setBusy(true);
      try {
        await onClick();
      } finally {
        setBusy(false);
      }
      return;
    }
    if (href) window.open(href, "_blank", "noopener,noreferrer");
  }

  return (
    <button
      type="button"
      onClick={() => void handleClick()}
      disabled={busy}
      aria-label={busy ? "Opening…" : label}
      title={label}
      className={APPS_AIRPORT_ROW_ACTION_BTN_CLASS}
    >
      <IonIcon name={icon} size={20} className="text-white" />
    </button>
  );
}
