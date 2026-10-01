import { randomBytes } from "crypto";
import { SignJWT, jwtVerify } from "jose";
import { ETSY_OAUTH_STATE_TTL_MS } from "./constants";

const ISSUER = "nwc-etsy-oauth";

export type EtsyOAuthStatePayload = {
  memberId: string;
  nonce: string;
};

function secret() {
  const s = process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error("NEXTAUTH_SECRET is required");
  return new TextEncoder().encode(s);
}

export function createEtsyOAuthNonce(): string {
  return randomBytes(32).toString("hex");
}

export async function signEtsyOAuthState(input: {
  memberId: string;
  nonce: string;
}): Promise<string> {
  return new SignJWT({ nonce: input.nonce })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(input.memberId)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${Math.floor(ETSY_OAUTH_STATE_TTL_MS / 1000)}s`)
    .sign(secret());
}

export async function verifyEtsyOAuthState(state: string): Promise<EtsyOAuthStatePayload | null> {
  try {
    const { payload } = await jwtVerify(state, secret(), { issuer: ISSUER });
    const memberId = payload.sub;
    const nonce = typeof payload.nonce === "string" ? payload.nonce : "";
    if (!memberId || !/^[a-f0-9]{64}$/.test(nonce)) return null;
    return { memberId, nonce };
  } catch {
    return null;
  }
}
