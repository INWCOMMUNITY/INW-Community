"use client";

import { useEffect } from "react";

/**
 * Body scroll lock that actually prevents background scroll (including on mobile).
 * Uses position:fixed on body and restores scroll position on unlock.
 * Ref-counted so multiple modals can lock/unlock independently.
 */

let lockCount = 0;
let savedScrollY = 0;

function lock() {
  lockCount += 1;
  if (lockCount === 1) {
    savedScrollY = typeof window !== "undefined" ? window.scrollY ?? window.pageYOffset : 0;
    document.body.style.setProperty("position", "fixed");
    document.body.style.setProperty("top", `-${savedScrollY}px`);
    document.body.style.setProperty("left", "0");
    document.body.style.setProperty("right", "0");
    document.body.style.setProperty("width", "100%");
    document.body.style.setProperty("overflow", "hidden");
    document.body.style.setProperty("overscroll-behavior", "none");
  }
}

function unlock() {
  if (lockCount <= 0) return;
  lockCount -= 1;
  if (lockCount === 0) {
    document.body.style.removeProperty("position");
    document.body.style.removeProperty("top");
    document.body.style.removeProperty("left");
    document.body.style.removeProperty("right");
    document.body.style.removeProperty("width");
    document.body.style.removeProperty("overflow");
    document.body.style.removeProperty("overscroll-behavior");
    if (typeof window !== "undefined") {
      window.scrollTo(0, savedScrollY);
    }
  }
}

export function lockBodyScroll() {
  if (typeof document === "undefined") return;
  lock();
}

export function unlockBodyScroll() {
  if (typeof document === "undefined") return;
  unlock();
}

/**
 * Call with true when a modal is open so the page behind cannot scroll.
 * Call with false or unmount to restore scrolling.
 */
export function useLockBodyScroll(locked: boolean): void {
  useEffect(() => {
    if (!locked) return;
    lock();
    return () => {
      unlock();
    };
  }, [locked]);
}
