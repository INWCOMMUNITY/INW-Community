import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionForApi } from "@/lib/mobile-auth";
import { memberHasStorefrontListingAccess } from "@/lib/storefront-seller-access";
import { CHANNEL_PROVIDERS, isChannelProvider } from "@/lib/channels/types";
import { createBatchImportJob, serializeBatchImportJob } from "@/lib/channels/batch-import";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  provider: z.string().refine(isChannelProvider, {
    message: `provider must be one of: ${CHANNEL_PROVIDERS.join(", ")}`,
  }),
  listingIds: z.array(z.string().min(1)).min(1, "Select at least one listing to import."),
});

/**
 * POST /api/channels/import-job
 * Create a batch import job so the client can poll percent and import one listing at a time.
 */
export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const canList = await memberHasStorefrontListingAccess(userId);
  if (!canList) {
    return NextResponse.json({ error: "Seller plan required to import listings." }, { status: 403 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.errors[0]?.message : "Invalid input";
    return NextResponse.json({ error: String(msg) }, { status: 400 });
  }

  const listingIds = [...new Set(body.listingIds.map((id) => id.trim()).filter(Boolean))];
  const job = await createBatchImportJob(userId, body.provider, listingIds.length, listingIds);

  return NextResponse.json(
    {
      jobId: job.id,
      ...serializeBatchImportJob(job),
    },
    { status: 201 }
  );
}
