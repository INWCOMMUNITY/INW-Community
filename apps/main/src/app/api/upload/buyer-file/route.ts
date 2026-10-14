import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { getSessionForApi } from "@/lib/mobile-auth";
import { requireBlobStorage } from "@/lib/upload";
import path from "path";
import fs from "fs/promises";

export const maxDuration = 60;

/** Matches the general upload ceiling, and Etsy’s 100MB buyer-file cap. */
const MAX_BUYER_FILE_BYTES = 100 * 1024 * 1024;

const ALLOWED = new Set([
  "image/jpeg",
  "image/png",
  "image/svg+xml",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
]);

function extOk(name: string): boolean {
  return /\.(jpe?g|png|svg|webp|hei[cf]|pdf)$/i.test(name);
}

export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const formData = await req.formData();
  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  if (file.size > MAX_BUYER_FILE_BYTES) {
    return NextResponse.json({ error: "File too large (max 100MB)" }, { status: 400 });
  }
  if (!ALLOWED.has(file.type) && !extOk(file.name)) {
    return NextResponse.json(
      { error: "Use jpg, png, svg, pdf, webp, or heic." },
      { status: 400 }
    );
  }

  const blobCheck = requireBlobStorage();
  if (!blobCheck.ok) {
    return NextResponse.json({ error: blobCheck.error }, { status: blobCheck.status });
  }
  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const ext = path.extname(file.name) || ".bin";
    const filename = `${session.user.id}-${Date.now()}${ext}`;
    if (process.env.BLOB_READ_WRITE_TOKEN) {
      try {
        const stored = await put(`buyer-files/${session.user.id}/${Date.now()}${ext}`, bytes, {
          access: "public",
          contentType: file.type || "application/octet-stream",
        });
        return NextResponse.json({ url: stored.url });
      } catch (error) {
        // Local dev often has a token that Blob rejects. The public folder still works here.
        if (process.env.VERCEL) throw error;
        console.error("[buyer-file] blob rejected, storing on disk", error);
      }
    }

    const dir = path.join(process.cwd(), "public", "uploads", "buyer-files");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, filename), bytes);
    return NextResponse.json({ url: `/uploads/buyer-files/${filename}` });
  } catch (error) {
    console.error("[buyer-file]", error);
    return NextResponse.json({ error: "Could not upload that photo. Try again." }, { status: 500 });
  }
}
