import { ETSY_OAUTH_SCOPES } from "./constants";

/** Etsy grants scopes as a space-delimited string. */
export function missingEtsyScopes(
  grantedSpaceDelimited: string,
  required: readonly string[] = ETSY_OAUTH_SCOPES
): string[] {
  const granted = new Set(
    grantedSpaceDelimited
      .split(/[\s,]+/)
      .map((scope) => scope.trim())
      .filter(Boolean)
  );
  return required.filter((scope) => !granted.has(scope));
}

export function normalizeEtsyGrantedScopes(granted: string): string {
  return granted
    .split(/[\s,]+/)
    .map((scope) => scope.trim())
    .filter(Boolean)
    .join(" ");
}
