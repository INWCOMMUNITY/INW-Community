import { NextRequest, NextResponse } from "next/server";
import { getSessionForApi } from "@/lib/mobile-auth";
import { archiveShippingOption, updateInwShippingOption } from "@/lib/shipping-options";
import { z } from "zod";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  lengthIn: z.coerce.number().positive().optional(),
  widthIn: z.coerce.number().positive().optional(),
  heightIn: z.coerce.number().positive().optional(),
  weightLbs: z.coerce.number().min(0).optional(),
  weightOz: z.coerce.number().min(0).max(15.99).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid shipping option" }, { status: 400 });
  }
  try {
    const option = await updateInwShippingOption(userId, id, parsed.data);
    if (!option) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ option });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not update option" },
      { status: 400 }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const ok = await archiveShippingOption(userId, id);
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
