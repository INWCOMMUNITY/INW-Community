import { prisma } from "database";
import type { PageStructure } from "types";

export async function getSiteContent(pageId: string): Promise<PageStructure | null> {
  const row = await prisma.siteContent.findUnique({
    where: { pageId },
  });
  const structure = (row?.structure as unknown as PageStructure) ?? null;
  if (!structure?.sections?.length) return null;
  return structure;
}
