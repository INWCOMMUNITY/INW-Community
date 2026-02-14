import { NextResponse } from "next/server";
import { prisma } from "database";
import type { PageStructure } from "types";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ pageId: string }> }
) {
  const { pageId } = await params;
  const row = await prisma.siteContent.findUnique({
    where: { pageId },
  });
  const structure: PageStructure = (row?.structure as unknown as PageStructure) ?? { sections: [] };
  return NextResponse.json(structure);
}
