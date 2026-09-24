import { randomBytes } from "crypto";
import { SignJWT, jwtVerify } from "jose";
import { SHOPIFY_OAUTH_STATE_TTL_MS } from "./constants";
import { normalizeShopifyShopDomain } from "./shop-domain";

const ISSUER = "nwc-shopify-oauth";

export type ShopifyOAuthStatePayload = {
  memberId: string;
  shopDomain: string;
  nonce: string;
};

function secret() {
  const s = process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error("NEXTAUTH_SECRET is required");
  return new TextEncoder().encode(s);
}

export function createShopifyOAuthNonce(): string {
  return randomBytes(32).toString("hex");
}

export async function signShopifyOAuthState(input: {
  memberId: string;
  shopDomain: string;
  nonce: string;
}): Promise<string> {
  const shopDomain = normalizeShopifyShopDomain(input.shopDomain);
  if (!shopDomain) throw new Error("Invalid shop domain");
  return new SignJWT({ shopDomain, nonce: input.nonce })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(input.memberId)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${Math.floor(SHOPIFY_OAUTH_STATE_TTL_MS / 1000)}s`)
    .sign(secret());
}

export async function verifyShopifyOAuthState(
  state: string
): Promise<ShopifyOAuthStatePayload | null> {
  try {
    const { payload } = await jwtVerify(state, secret(), { issuer: ISSUER });
    const memberId = payload.sub;
    const shopDomain =
      typeof payload.shopDomain === "string" ? normalizeShopifyShopDomain(payload.shopDomain) : null;
    const nonce = typeof payload.nonce === "string" ? payload.nonce : "";
    if (!memberId || !shopDomain || !/^[a-f0-9]{64}$/.test(nonce)) return null;
    return { memberId, shopDomain, nonce };
  } catch {
    return null;
  }
}
