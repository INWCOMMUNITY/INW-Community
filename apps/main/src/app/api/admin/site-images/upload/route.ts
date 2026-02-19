import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import path from "path";
import { revalidatePath } from "next/cache";
import { requireBlobStorage } from "@/lib/upload";
import fs from "fs/promises";
import { requireAdmin } from "@/lib/admin-auth";
import { prisma } from "database";
import { SITE_IMAGE_KEYS } from "@/lib/site-images";

const SITE_IMAGES_KEY = "site_images";
const VERSION_KEY = "_v";
const MAX_SIZE = 40 * 1024 * 1024; // 40MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

/** POST: Upload and replace a site image. FormData: file, key */
export async function POST(req: NextRequest) {
  if (!(await requireAdmin(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const blobCheck = requireBlobStorage();
  if (!blobCheck.ok) {
    return NextResponse.json({ error: blobCheck.error }, { status: blobCheck.status });
  }

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const key = formData.get("key") as string | null;

  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  if (!key || !SITE_IMAGE_KEYS.some((k) => k.key === key)) {
    return NextResponse.json({ error: "Invalid or missing key" }, { status: 400 });
  }

  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "File too large (max 40MB)" }, { status: 400 });
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: "Invalid file type. Use JPEG, PNG, WebP, or GIF." }, { status: 400 });
  }

  const ext = path.extname(file.name) || ".jpg";
  const filename = `site-images/${key}${ext}`;

  // Store at original quality—no resizing or compression. File bytes are written as-is to Blob or public/uploads.
  try {
    let url: string;
    if (process.env.BLOB_READ_WRITE_TOKEN) {
      const blob = await put(filename, file, {
        access: "public",
        addRandomSuffix: false,
      });
      url = blob.url;
    } else {
      const bytes = await file.arrayBuffer();
      const buffer = Buffer.from(bytes);
      const publicDir = path.join(process.cwd(), "public", "uploads");
      const fullPath = path.join(publicDir, filename);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, buffer);
      const base = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || "http://localhost:3000";
      url = `${base.replace(/\/$/, "")}/uploads/${filename}`;
    }

    const row = await prisma.siteSetting.findUnique({ where: { key: SITE_IMAGES_KEY } });
    const value = row?.value && typeof row.value === "object"
      ? { ...(row.value as Record<string, unknown>) }
      : {};
    const overrides = value as Record<string, unknown>;
    overrides[key] = url;
    overrides[VERSION_KEY] = Date.now();

    await prisma.siteSetting.upsert({
      where: { key: SITE_IMAGES_KEY },
      create: { key: SITE_IMAGES_KEY, value: overrides },
      update: { value: overrides },
    });

    revalidatePath("/", "layout");

    return NextResponse.json({ url });
  } catch (e) {
    console.error("[site-images upload]", e);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
