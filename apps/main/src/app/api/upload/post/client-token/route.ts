import { NextRequest, NextResponse } from "next/server";
import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client";
import { getSessionForApi } from "@/lib/mobile-auth";
import {
  POST_UPLOAD_ALLOWED_IMAGE_TYPES,
  POST_UPLOAD_ALLOWED_VIDEO_TYPES,
  POST_UPLOAD_MAX_IMAGE_BYTES,
  POST_UPLOAD_MAX_VIDEO_BYTES,
  postUploadEffectiveMime,
} from "@/lib/post-upload";

export const runtime = "nodejs";

/**
 * Issues a short-lived Vercel Blob client token + pathname (~KB JSON).
 * Mobile uploads bytes directly to blob.vercel-storage.com (bypasses ~4.5MB Vercel function body limit).
 */
export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rw = process.env.BLOB_READ_WRITE_TOKEN;
  if (!rw) {
    return NextResponse.json(
      {
        error: "Blob storage not configured",
        code: "USE_MULTIPART_FALLBACK",
      },
      { status: 503 }
    );
  }

  let body: {
    uploadKind?: string;
    contentType?: string;
    filenameHint?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const uploadKind = ((body.uploadKind as string) || "image").toLowerCase();
  const isVideo = uploadKind === "video";
  const syntheticName =
    typeof body.filenameHint === "string" && body.filenameHint.trim()
      ? body.filenameHint.trim()
      : isVideo
        ? "upload.mp4"
        : "upload.jpg";

  const normalizedType = postUploadEffectiveMime(body.contentType ?? "", syntheticName, isVideo);
  if (!normalizedType) {
    return NextResponse.json(
      {
        error: isVideo
          ? "Invalid video type. Use MP4, WebM, or MOV."
          : "Invalid image type. Use JPEG, PNG, WebP, GIF, or HEIC.",
      },
      { status: 400 }
    );
  }

  const maxBytes = isVideo ? POST_UPLOAD_MAX_VIDEO_BYTES : POST_UPLOAD_MAX_IMAGE_BYTES;
  const extFromName = syntheticName.includes(".") ? syntheticName.slice(syntheticName.lastIndexOf(".")) : "";
  const ext =
    extFromName.match(/^\.(jpe?g|png|webp|gif|heic|heif|mp4|m4v|webm|mov)$/i)?.[0] ??
    (isVideo ? ".mp4" : ".jpg");
  const subdir = isVideo ? "video" : "image";
  const pathname = `post/${session.user.id}/${subdir}/${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;

  try {
    const allowedList = (
      isVideo ? POST_UPLOAD_ALLOWED_VIDEO_TYPES : POST_UPLOAD_ALLOWED_IMAGE_TYPES
    ) as unknown as string[];

    const clientToken = await generateClientTokenFromReadWriteToken({
      pathname,
      token: rw,
      maximumSizeInBytes: maxBytes,
      allowedContentTypes: allowedList,
      addRandomSuffix: false,
    });

    return NextResponse.json({
      pathname,
      clientToken,
      contentType: normalizedType,
    });
  } catch (e) {
    console.error("[upload post client-token]", e);
    return NextResponse.json({ error: "Could not prepare upload" }, { status: 500 });
  }
}
