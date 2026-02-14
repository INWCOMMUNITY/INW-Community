import EasyPostClient from "@easypost/api";
import { prisma } from "database";
import { decrypt } from "@/lib/encrypt";

/**
 * Returns an EasyPost client for the seller's connected account, or null if not connected.
 * Use for rates and label purchase so the seller's card is charged.
 */
export async function getSellerEasyPostClient(
  memberId: string
): Promise<InstanceType<typeof EasyPostClient> | null> {
  const member = await prisma.member.findUnique({
    where: { id: memberId },
    select: { easypostApiKeyEncrypted: true },
  });
  if (!member?.easypostApiKeyEncrypted) return null;
  try {
    const key = decrypt(member.easypostApiKeyEncrypted);
    return new EasyPostClient(key);
  } catch {
    return null;
  }
}
