"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const DEFAULT_DELAY_MS = 1500;

function useIsDesktopHover() {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px) and (hover: hover)");
    const sync = () => setOk(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return ok;
}

/**
 * Shows a small thought-bubble tooltip above children after a hover delay.
 * Desktop hover only; portals so parent overflow does not clip it.
 */
export function DelayedThoughtBubble({
  label,
  children,
  delayMs = DEFAULT_DELAY_MS,
}: {
  label: string;
  children: ReactNode;
  delayMs?: number;
}) {
  const reactId = useId();
  const desktopHover = useIsDesktopHover();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [tip, setTip] = useState<{ top: number; left: number } | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const hide = useCallback(() => {
    clearTimer();
    setTip(null);
  }, [clearTimer]);

  const onEnter = useCallback(() => {
    if (!desktopHover) return;
    clearTimer();
    timerRef.current = setTimeout(() => {
      const el = wrapRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setTip({
        top: rect.top,
        left: rect.left + rect.width / 2,
      });
    }, delayMs);
  }, [desktopHover, clearTimer, delayMs]);

  useEffect(() => () => clearTimer(), [clearTimer]);

  return (
    <div
      ref={wrapRef}
      className="relative inline-flex"
      onMouseEnter={onEnter}
      onMouseLeave={hide}
    >
      {children}
      {tip &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            id={`${reactId}-tip`}
            className="pointer-events-none fixed z-[9999] flex -translate-x-1/2 -translate-y-full flex-col items-center pb-1.5"
            style={{ top: tip.top, left: tip.left }}
            role="tooltip"
          >
            <div className="whitespace-nowrap rounded-2xl border border-neutral-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-neutral-800 shadow-md">
              {label}
            </div>
            <span
              className="mt-[-1px] h-2 w-2 rotate-45 border-b border-r border-neutral-200 bg-white"
              aria-hidden
            />
          </div>,
          document.body
        )}
    </div>
  );
}
