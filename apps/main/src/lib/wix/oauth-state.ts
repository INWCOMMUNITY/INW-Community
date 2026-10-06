import { createHmac, randomBytes } from "crypto";

const OAUTH_STATE_SECRET = process.env.NEXTAUTH_SECRET || process.env.WIX_OAUTH_STATE_SECRET || "wix-oauth-state-secret";

/**
 * Create a cryptographically random nonce for OAuth state.
 */
export function createWixOAuthNonce(): string {
  return randomBytes(16).toString("hex");
}

/**
 * Sign an OAuth state with a MAC to prevent tampering.
 */
export async function signWixOAuthState(input: {
  memberId: string;
  nonce: string;
}): Promise<string> {
  const payload = JSON.stringify({
    memberId: input.memberId,
    nonce: input.nonce,
    ts: Date.now(),
  });

  const mac = createHmac("sha256", OAUTH_STATE_SECRET)
    .update(payload, "utf8")
    .digest("base64url");

  const state = Buffer.from(payload, "utf8").toString("base64url") + "." + mac;
  return state;
}

/**
 * Verify and decode an OAuth state.
 * Returns null if the state is invalid or tampered with.
 */
export async function verifyWixOAuthState(
  state: string
): Promise<{ memberId: string; nonce: string } | null> {
  const parts = state.split(".");
  if (parts.length !== 2) return null;

  const [payloadB64, mac] = parts;
  if (!payloadB64 || !mac) return null;

  let payload: string;
  try {
    payload = Buffer.from(payloadB64, "base64url").toString("utf8");
  } catch {
    return null;
  }

  const expectedMac = createHmac("sha256", OAUTH_STATE_SECRET)
    .update(payload, "utf8")
    .digest("base64url");

  // Constant-time comparison
  if (mac.length !== expectedMac.length) return null;
  let result = 0;
  for (let i = 0; i < mac.length; i++) {
    result |= mac.charCodeAt(i) ^ expectedMac.charCodeAt(i);
  }
  if (result !== 0) return null;

  let parsed: { memberId?: string; nonce?: string };
  try {
    parsed = JSON.parse(payload) as { memberId?: string; nonce?: string };
  } catch {
    return null;
  }

  if (!parsed.memberId || !parsed.nonce) return null;

  return {
    memberId: parsed.memberId,
    nonce: parsed.nonce,
  };
}
