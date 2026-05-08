import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { getSessionForApi } from "@/lib/mobile-auth";
import { requireBlobStorage } from "@/lib/upload";
import path from "path";
import fs from "fs/promises";
import {
  POST_UPLOAD_MAX_IMAGE_BYTES,
  POST_UPLOAD_MAX_VIDEO_BYTES,
  postUploadEffectiveMime,
} from "@/lib/post-upload";

export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await req.formData();
  const uploadKind = ((formData.get("type") as string) || "image").toLowerCase(); // image | video
  const isVideoRequest = uploadKind === "video";
  const filePart = formData.get("file") as unknown;

  // Accept File or Blob (React Native often sends Blob; default name/mime must match upload kind)
  const blobFallbackName = isVideoRequest ? "upload.mp4" : "upload.jpg";
  const blobFallbackMime = isVideoRequest ? "video/mp4" : "image/jpeg";

  let file: File | null = null;
  if (filePart instanceof File) {
    file = filePart;
  } else if (filePart instanceof Blob) {
    file = new File([filePart], blobFallbackName, {
      type: filePart.type || blobFallbackMime,
    });
  }
  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const isVideo = isVideoRequest;
  const maxSize = isVideo ? POST_UPLOAD_MAX_VIDEO_BYTES : POST_UPLOAD_MAX_IMAGE_BYTES;

  if (file.size > maxSize) {
    return NextResponse.json({ error: `File too large (max ${isVideo ? "100" : "60"}MB)` }, { status: 400 });
  }

  const name = file instanceof File ? file.name : "upload.jpg";
  const normalizedType = postUploadEffectiveMime(file.type, name, isVideo);
  if (!normalizedType) {
    return NextResponse.json({
      error: isVideo
        ? "Invalid video type. Use MP4, WebM, or MOV."
        : "Invalid image type. Use JPEG, PNG, WebP, GIF, or HEIC.",
    }, { status: 400 });
  }
  if (normalizedType !== file.type && file instanceof File) {
    try {
      file = new File([file], name, { type: normalizedType });
    } catch {
      /* use original file; blob.put accepts stream */
    }
  }
  const ext = path.extname(name) || (isVideo ? ".mp4" : ".jpg");
  const subdir = isVideo ? "video" : "image";
  const filename = `post/${session.user.id}/${subdir}/${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;

  const blobCheck = requireBlobStorage();
  if (!blobCheck.ok) {
    return NextResponse.json({ error: blobCheck.error }, { status: blobCheck.status });
  }

  try {
    if (process.env.BLOB_READ_WRITE_TOKEN) {
      const blob = await put(filename, file, {
        access: "public",
        addRandomSuffix: false,
      });
      return NextResponse.json({ url: blob.url, type: isVideo ? "video" : "image" });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const publicDir = path.join(process.cwd(), "public", "uploads");
    const fullPath = path.join(publicDir, filename);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, buffer);
    const url = `/uploads/${filename}`;
    return NextResponse.json({ url, type: isVideo ? "video" : "image" });
  } catch (e) {
    console.error("[upload post]", e);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
