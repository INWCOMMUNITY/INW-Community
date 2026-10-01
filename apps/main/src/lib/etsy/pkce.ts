import { createHash, randomBytes } from "crypto";

/**
 * PKCE code_verifier: 43–128 unreserved URI characters.
 * 32 random bytes → base64url ≈ 43 chars (RFC 7636 Appendix B style).
 */
export function createEtsyCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

export function createEtsyCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier, "utf8").digest("base64url");
}
