/**
 * Mobile + web chat typing UX.
 * - Local composer: while the field is focused, REFRESH pings keep remote TTL from expiring.
 * - Remote indicator: TTL after last active:true (must exceed REFRESH interval + jitter).
 */
export const CHAT_COMPOSER_TYPING_REFRESH_MS = 4000;
export const CHAT_PEER_TYPING_INDICATOR_TTL_MS = 12_000;
