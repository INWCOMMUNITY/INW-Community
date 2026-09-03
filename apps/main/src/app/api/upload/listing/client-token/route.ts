import { NextRequest, NextResponse } from "next/server";
import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client";
import { requireListingPhotoUploadAccess } from "@/lib/listing-photo-upload-access";
import {
  LISTING_PHOTO_ALLOWED_TYPES,
  listingPhotoEffectiveMime,
  listingPhotoExtForMime,
  MAX_LISTING_PHOTO_BYTES,
} from "@/lib/listing-photo-upload";
import { formatListingPhotoSizeLabel } from "@/lib/upload-limits";

export const runtime = "nodejs";

/**
 * Short-lived Vercel Blob token so listing photos upload directly to storage
 * and skip the ~4.5MB serverless request-body cap.
 */
export async function POST(req: NextRequest) {
  const access = await requireListingPhotoUploadAccess(req);
  if (!access.ok) return access.response;

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

  let body: { contentType?: string; filenameHint?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const filenameHint =
    typeof body.filenameHint === "string" && body.filenameHint.trim()
      ? body.filenameHint.trim()
      : "photo.jpg";
  const normalizedType = listingPhotoEffectiveMime(body.contentType ?? "", filenameHint);
  if (!normalizedType) {
    return NextResponse.json(
      { error: "Invalid file type. Use JPEG, PNG, WebP, GIF, or HEIC." },
      { status: 400 }
    );
  }

  const ext = listingPhotoExtForMime(normalizedType, filenameHint);
  const pathname = `listing/${access.userId}/${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;

  try {
    const clientToken = await generateClientTokenFromReadWriteToken({
      pathname,
      token: rw,
      maximumSizeInBytes: MAX_LISTING_PHOTO_BYTES,
      allowedContentTypes: [...LISTING_PHOTO_ALLOWED_TYPES],
      addRandomSuffix: false,
    });

    return NextResponse.json({
      pathname,
      clientToken,
      contentType: normalizedType,
      maxBytes: MAX_LISTING_PHOTO_BYTES,
      maxLabel: formatListingPhotoSizeLabel(),
    });
  } catch (e) {
    console.error("[upload listing client-token]", e);
    return NextResponse.json({ error: "Could not prepare upload" }, { status: 500 });
  }
}
