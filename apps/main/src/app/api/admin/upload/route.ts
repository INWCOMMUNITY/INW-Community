import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import path from "path";
import { requireBlobStorage } from "@/lib/upload";
import fs from "fs/promises";
import { requireAdmin } from "@/lib/admin-auth";
import { padBusinessLogoToSquareJpeg } from "@/lib/business-logo-square";

const MAX_SIZE = 80 * 1024 * 1024; // 80MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export async function POST(req: NextRequest) {
  if (!(await requireAdmin(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "File too large (max 80MB)" }, { status: 400 });
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: "Invalid file type. Use JPEG, PNG, WebP, or GIF." }, { status: 400 });
  }

  const purposeRaw = formData.get("purpose");
  const letterboxLogo =
    typeof purposeRaw === "string" && purposeRaw.trim() === "business-logo";

  let outExt = path.extname(file.name) || ".jpg";
  let contentType = file.type;
  let uploadBuffer: Buffer | null = null;

  if (letterboxLogo) {
    const rawBuffer = Buffer.from(await file.arrayBuffer());
    try {
      uploadBuffer = await padBusinessLogoToSquareJpeg(rawBuffer);
      outExt = ".jpg";
      contentType = "image/jpeg";
    } catch (e) {
      console.error("[admin upload] business-logo letterbox failed, storing original", e);
      uploadBuffer = rawBuffer;
      outExt = path.extname(file.name) || ".jpg";
      contentType = file.type;
    }
  }

  const filename = `admin/${Date.now()}-${Math.random().toString(36).slice(2)}${outExt}`;

  const blobCheck = requireBlobStorage();
  if (!blobCheck.ok) {
    return NextResponse.json({ error: blobCheck.error }, { status: blobCheck.status });
  }

  try {
    if (process.env.BLOB_READ_WRITE_TOKEN) {
      const blob = await put(filename, uploadBuffer ?? file, {
        access: "public",
        addRandomSuffix: false,
        contentType: contentType || undefined,
      });
      return NextResponse.json({ url: blob.url });
    }

    const buffer = uploadBuffer ?? Buffer.from(await file.arrayBuffer());
    const publicDir = path.join(process.cwd(), "public", "uploads");
    const fullPath = path.join(publicDir, filename);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, buffer);
    const url = `/uploads/${filename}`;
    return NextResponse.json({ url });
  } catch (e) {
    console.error("[admin upload]", e);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
