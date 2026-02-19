import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "database";
import { requireAdmin } from "@/lib/admin-auth";
import { SITE_IMAGE_KEYS } from "@/lib/site-images";

const SITE_IMAGES_KEY = "site_images";
const VERSION_KEY = "_v";

type Overrides = Record<string, string>;

async function getOverrides(): Promise<{ overrides: Overrides; version: number }> {
  const row = await prisma.siteSetting.findUnique({ where: { key: SITE_IMAGES_KEY } });
  if (!row?.value || typeof row.value !== "object") return { overrides: {}, version: 0 };
  const v = row.value as Record<string, unknown>;
  const overrides: Overrides = {};
  let version = 0;
  for (const [k, val] of Object.entries(v)) {
    if (k === VERSION_KEY && typeof val === "number") version = val;
    else if (typeof val === "string") overrides[k] = val;
  }
  return { overrides, version };
}

/** GET: List all site images with current URLs */
export async function GET(req: NextRequest) {
  if (!(await requireAdmin(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { overrides, version } = await getOverrides();
    const url = new URL(req.url);
    const base = url.origin;
    const v = version ? `?v=${version}` : "";
    const items = SITE_IMAGE_KEYS.map(({ key, path, label }) => {
      const raw = overrides[key] ?? `${base}${path}`;
      return {
        key,
        label,
        path,
        url: raw + (raw.includes("?") ? "" : v),
        isOverridden: !!overrides[key],
      };
    });
    return NextResponse.json({ items });
  } catch (e) {
    console.error("[site-images GET]", e);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

/** DELETE: Reset a site image to default (clear override) */
export async function DELETE(req: NextRequest) {
  if (!(await requireAdmin(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const key = searchParams.get("key");
  const validKey = SITE_IMAGE_KEYS.some((k) => k.key === key);
  if (!key || !validKey) {
    return NextResponse.json({ error: "Invalid key" }, { status: 400 });
  }
  try {
    const { overrides } = await getOverrides();
    delete overrides[key];
    const value = { ...overrides, [VERSION_KEY]: Date.now() };
    await prisma.siteSetting.upsert({
      where: { key: SITE_IMAGES_KEY },
      create: { key: SITE_IMAGES_KEY, value },
      update: { value },
    });
    revalidatePath("/", "layout");
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[site-images DELETE]", e);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
