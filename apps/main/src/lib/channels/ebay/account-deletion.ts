import { createHash } from "crypto";
import { prisma } from "database";

/** eBay hashes challengeCode + verificationToken + endpoint (exact URL registered in the portal). */
export function computeEbayAccountDeletionChallengeResponse(args: {
  challengeCode: string;
  verificationToken: string;
  endpoint: string;
}): string {
  const hash = createHash("sha256");
  hash.update(args.challengeCode);
  hash.update(args.verificationToken);
  hash.update(args.endpoint);
  return hash.digest("hex");
}

export function getEbayAccountDeletionVerificationToken(): string | null {
  return process.env.EBAY_ACCOUNT_DELETION_VERIFICATION_TOKEN?.trim() || null;
}

/** Must match the Notification Endpoint URL in eBay exactly (no query string). */
export function resolveEbayAccountDeletionEndpoint(reqUrl: string): string {
  const configured = process.env.EBAY_ACCOUNT_DELETION_ENDPOINT?.trim();
  if (configured) return configured;
  const url = new URL(reqUrl);
  return `${url.origin}${url.pathname}`;
}

type DeletionIdentifiers = {
  username?: string | null;
  userId?: string | null;
};

/** Remove stored eBay seller connection data when eBay notifies us of account closure. */
export async function purgeEbayAccountData(
  ids: DeletionIdentifiers
): Promise<{ deletedConnections: number }> {
  const keys = [ids.username, ids.userId].filter((v): v is string => Boolean(v?.trim()));
  if (keys.length === 0) return { deletedConnections: 0 };

  const connections = await prisma.channelConnection.findMany({
    where: {
      provider: "ebay",
      OR: [{ externalShopId: { in: keys } }, { externalShopName: { in: keys } }],
    },
    select: { id: true },
  });

  if (connections.length === 0) return { deletedConnections: 0 };

  await prisma.channelConnection.deleteMany({
    where: { id: { in: connections.map((c) => c.id) } },
  });

  return { deletedConnections: connections.length };
}
