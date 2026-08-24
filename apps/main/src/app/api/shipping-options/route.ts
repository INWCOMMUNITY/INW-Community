import { NextRequest, NextResponse } from "next/server";
import { getSessionForApi } from "@/lib/mobile-auth";
import {
  createInwShippingOption,
  getShippingOptionPrefs,
  importRemoteShippingOptions,
  listShippingOptions,
  parseShippingCostCentsInput,
  updateShippingOptionPrefs,
} from "@/lib/shipping-options";
import { z } from "zod";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  name: z.string().min(1).max(120),
  lengthIn: z.coerce.number().positive(),
  widthIn: z.coerce.number().positive(),
  heightIn: z.coerce.number().positive(),
  weightLbs: z.coerce.number().min(0).default(0),
  weightOz: z.coerce.number().min(0).default(0),
  shippingCostCents: z.coerce.number().int().min(0).optional(),
  shippingCostDollars: z.union([z.string(), z.number()]).optional(),
});

const prefsSchema = z.object({
  offerFreeShippingOnInw: z.boolean().optional(),
  importEbayShippingOptions: z.boolean().optional(),
  importEtsyShippingOptions: z.boolean().optional(),
});

export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [options, prefs] = await Promise.all([
    listShippingOptions(userId),
    getShippingOptionPrefs(userId),
  ]);
  return NextResponse.json({ options, ...prefs });
}

export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid shipping option", details: parsed.error.flatten() }, { status: 400 });
  }
  try {
    const shippingCostCents = parseShippingCostCentsInput({
      shippingCostCents: parsed.data.shippingCostCents,
      shippingCostDollars: parsed.data.shippingCostDollars,
      required: true,
    });
    const option = await createInwShippingOption(userId, {
      name: parsed.data.name,
      lengthIn: parsed.data.lengthIn,
      widthIn: parsed.data.widthIn,
      heightIn: parsed.data.heightIn,
      weightLbs: parsed.data.weightLbs,
      weightOz: parsed.data.weightOz,
      shippingCostCents: shippingCostCents ?? 0,
    });
    return NextResponse.json({ option }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not create option" }, { status: 400 });
  }
}

export async function PATCH(req: NextRequest) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = prefsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid preferences" }, { status: 400 });
  }
  try {
    const prefs = await updateShippingOptionPrefs(userId, parsed.data);
    const imports: { provider: string; imported: number; error?: string }[] = [];
    if (parsed.data.importEbayShippingOptions === true) {
      imports.push({ provider: "ebay", ...(await importRemoteShippingOptions(userId, "ebay")) });
    }
    if (parsed.data.importEtsyShippingOptions === true) {
      imports.push({ provider: "etsy", ...(await importRemoteShippingOptions(userId, "etsy")) });
    }
    const options = await listShippingOptions(userId);
    return NextResponse.json({ options, ...prefs, imports });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not save" },
      { status: 500 }
    );
  }
}
