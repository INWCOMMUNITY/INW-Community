import { SHOPIFY_OAUTH_SCOPES } from "./constants";

/** A granted write scope satisfies the matching read scope, per Shopify's OAuth contract. */
export function missingShopifyScopes(grantedCsv: string, required: readonly string[] = SHOPIFY_OAUTH_SCOPES): string[] {
  const granted = new Set(
    grantedCsv
      .split(",")
      .map((scope) => scope.trim())
      .filter(Boolean)
  );
  return required.filter((scope) => {
    if (granted.has(scope)) return false;
    if (scope.startsWith("read_") && granted.has(`write_${scope.slice("read_".length)}`)) return false;
    return true;
  });
}
