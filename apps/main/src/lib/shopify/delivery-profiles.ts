import { prisma } from "database";
import { accessTokenForConnection } from "@/lib/shopify/connect";
import { ShopifyRequestError } from "@/lib/shopify/client";
import { SHOPIFY_ADMIN_API_VERSION } from "@/lib/shopify/constants";
import { normalizeShopifyShopDomain } from "@/lib/shopify/shop-domain";

export type ShopifyRemoteShippingProfile = {
  source: "shopify";
  remoteProfileId: string;
  name: string;
  shippingCostCents?: number | null;
};

type MoneyV2 = { amount?: string | null; currencyCode?: string | null };

type MethodNode = {
  id?: string | null;
  name?: string | null;
  active?: boolean | null;
  rateProvider?: {
    price?: MoneyV2 | null;
  } | null;
};

type ZoneNode = {
  zone?: {
    name?: string | null;
    countries?: Array<{ code?: { countryCode?: string | null } | null } | null> | null;
  } | null;
  methodDefinitions?: { nodes?: Array<MethodNode | null> | null } | null;
};

type ProfileNode = {
  id?: string | null;
  name?: string | null;
  profileLocationGroups?: Array<{
    locationGroupZones?: { nodes?: Array<ZoneNode | null> | null } | null;
  } | null> | null;
};

type DeliveryProfilesQueryData = {
  deliveryProfiles: {
    nodes: ProfileNode[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
};

const DELIVERY_PROFILES_QUERY = `#graphql
query DeliveryProfilesForImport($cursor: String) {
  deliveryProfiles(first: 25, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      name
      profileLocationGroups {
        locationGroupZones(first: 25) {
          nodes {
            zone {
              name
              countries { code { countryCode } }
            }
            methodDefinitions(first: 25) {
              nodes {
                id
                name
                active
                rateProvider {
                  ... on DeliveryRateDefinition {
                    price { amount currencyCode }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}`;

function moneyToCents(price: MoneyV2 | null | undefined): number | null {
  if (!price?.amount) return null;
  const n = Number(price.amount);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

function zoneLooksDomestic(zone: ZoneNode["zone"]): boolean {
  const countries = zone?.countries ?? [];
  if (countries.length === 0) return true;
  return countries.some((c) => {
    const code = String(c?.code?.countryCode ?? "").toUpperCase();
    return code === "US" || code === "USA";
  });
}

function gidTail(gid: string): string {
  const parts = gid.split("/");
  return parts[parts.length - 1] || gid;
}

async function shopifyGraphql<T>(input: {
  shopDomain: string;
  accessToken: string;
  query: string;
  variables?: Record<string, unknown>;
}): Promise<T> {
  const shopDomain = normalizeShopifyShopDomain(input.shopDomain);
  if (!shopDomain) throw new ShopifyRequestError("Invalid shop domain");
  const response = await fetch(
    `https://${shopDomain}/admin/api/${SHOPIFY_ADMIN_API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Shopify-Access-Token": input.accessToken,
      },
      body: JSON.stringify({ query: input.query, variables: input.variables ?? {} }),
      signal: AbortSignal.timeout(30_000),
    }
  );
  if (!response.ok) {
    throw new ShopifyRequestError(`Shopify GraphQL failed (${response.status})`);
  }
  const body = (await response.json()) as { data?: T; errors?: unknown } | null;
  if (!body?.data) {
    throw new ShopifyRequestError("Shopify GraphQL returned errors");
  }
  return body.data;
}

/** Map Shopify delivery profiles/methods into INW import rows. */
export function mapShopifyDeliveryProfilesToRemote(
  nodes: ProfileNode[]
): ShopifyRemoteShippingProfile[] {
  const profiles: ShopifyRemoteShippingProfile[] = [];
  const seen = new Set<string>();

  for (const profile of nodes) {
    const profileId = String(profile.id ?? "").trim();
    const profileName = (profile.name ?? "Shopify shipping").trim() || "Shopify shipping";
    let methodCount = 0;

    for (const group of profile.profileLocationGroups ?? []) {
      for (const zoneNode of group?.locationGroupZones?.nodes ?? []) {
        if (!zoneNode || !zoneLooksDomestic(zoneNode.zone)) continue;
        for (const method of zoneNode.methodDefinitions?.nodes ?? []) {
          if (!method?.id || method.active === false) continue;
          const remoteProfileId = gidTail(method.id);
          if (!remoteProfileId || seen.has(remoteProfileId)) continue;
          seen.add(remoteProfileId);
          methodCount += 1;
          const methodName = (method.name ?? "Rate").trim() || "Rate";
          profiles.push({
            source: "shopify",
            remoteProfileId,
            name: `${profileName} — ${methodName}`,
            shippingCostCents: moneyToCents(method.rateProvider?.price),
          });
        }
      }
    }

    if (methodCount === 0 && profileId) {
      const remoteProfileId = gidTail(profileId);
      if (remoteProfileId && !seen.has(remoteProfileId)) {
        seen.add(remoteProfileId);
        profiles.push({
          source: "shopify",
          remoteProfileId,
          name: profileName,
          shippingCostCents: null,
        });
      }
    }
  }

  return profiles;
}

export async function fetchShopifyRemoteShippingProfiles(
  memberId: string
): Promise<{ profiles: ShopifyRemoteShippingProfile[]; error?: string }> {
  const connection = await prisma.shopifyConnection.findFirst({
    where: { memberId, status: "ACTIVE" },
    orderBy: { connectedAt: "desc" },
  });
  if (!connection) {
    return { profiles: [], error: "Connect Shopify first." };
  }

  try {
    const accessToken = await accessTokenForConnection(connection);
    const nodes: ProfileNode[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 5; page += 1) {
      const data: DeliveryProfilesQueryData = await shopifyGraphql<DeliveryProfilesQueryData>({
        shopDomain: connection.shopDomain,
        accessToken,
        query: DELIVERY_PROFILES_QUERY,
        variables: { cursor },
      });
      nodes.push(...(data.deliveryProfiles?.nodes ?? []));
      if (!data.deliveryProfiles?.pageInfo?.hasNextPage) break;
      const nextCursor: string | null = data.deliveryProfiles.pageInfo.endCursor ?? null;
      cursor = nextCursor;
      if (!cursor) break;
    }
    return { profiles: mapShopifyDeliveryProfilesToRemote(nodes) };
  } catch (e) {
    return {
      profiles: [],
      error: e instanceof Error ? e.message : "Could not load Shopify delivery profiles.",
    };
  }
}
