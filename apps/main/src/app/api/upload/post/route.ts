import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { getSessionForApi } from "@/lib/mobile-auth";
import { requireBlobStorage } from "@/lib/upload";
import path from "path";
import fs from "fs/promises";

const MAX_SIZE_IMAGE = 60 * 1024 * 1024; // 60MB per image
const MAX_SIZE_VIDEO = 100 * 1024 * 1024; // 100MB per video
const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
];
const ALLOWED_VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"];

function effectiveMime(rawType: string, fileName: string, isVideo: boolean): string | null {
  const t = (rawType || "").toLowerCase().trim();
  const allowed = isVideo ? ALLOWED_VIDEO_TYPES : ALLOWED_IMAGE_TYPES;
  if (allowed.includes(t)) return t;
  if (t !== "" && t !== "application/octet-stream") return null;
  const ext = path.extname(fileName).toLowerCase();
  const imageExt: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".heic": "image/heic",
    ".heif": "image/heif",
  };
  const videoExt: Record<string, string> = {
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
  };
  const map = isVideo ? videoExt : imageExt;
  const inferred = map[ext];
  return inferred && allowed.includes(inferred) ? inferred : null;
}

export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await req.formData();
  const filePart = formData.get("file") as unknown;
  const type = (formData.get("type") as string) || "image"; // image | video
  // Accept File or Blob (React Native / some runtimes send Blob for multipart file parts)
  let file: File | null = null;
  if (filePart instanceof File) {
    file = filePart;
  } else if (filePart instanceof Blob) {
    file = new File([filePart], "upload.jpg", { type: filePart.type || "image/jpeg" });
  }
  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const isVideo = type === "video";
  const maxSize = isVideo ? MAX_SIZE_VIDEO : MAX_SIZE_IMAGE;

  if (file.size > maxSize) {
    return NextResponse.json({ error: `File too large (max ${isVideo ? "100" : "60"}MB)` }, { status: 400 });
  }

  const name = file instanceof File ? file.name : "upload.jpg";
  const normalizedType = effectiveMime(file.type, name, isVideo);
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
