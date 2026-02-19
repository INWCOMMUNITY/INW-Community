import { NextResponse } from "next/server";
import { prisma } from "database";
import { cloudinaryFetchUrl } from "@/lib/cloudinary";

const SITE_IMAGES_KEY = "site_images";
export const dynamic = "force-dynamic";
const VERSION_KEY = "_v";

/** Public API: returns override URLs for site images (routed through Cloudinary with AI upscale). Client components use overrides[key] ?? defaultPath. */
export async function GET() {
  try {
    const row = await prisma.siteSetting.findUnique({ where: { key: SITE_IMAGES_KEY } });
    if (!row?.value || typeof row.value !== "object") {
      return NextResponse.json({});
    }
    const v = row.value as Record<string, unknown>;
    let version = 0;
    const out: Record<string, string> = {};
    for (const [k, val] of Object.entries(v)) {
      if (k === VERSION_KEY && typeof val === "number") version = val;
      else if (typeof val === "string") out[k] = val;
    }
    const suffix = version ? `?v=${version}` : "";
    const result: Record<string, string> = {};
    for (const [k, url] of Object.entries(out)) {
      const versionedUrl = url.includes("?") ? url : `${url}${suffix}`;
      result[k] = cloudinaryFetchUrl(versionedUrl, { upscale: true });
    }
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({});
  }
}
