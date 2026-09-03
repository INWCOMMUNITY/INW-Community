import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { requireListingPhotoUploadAccess } from "@/lib/listing-photo-upload-access";
import { isManagedListingPhotoUrl } from "@/lib/listing-photo-upload";
import { fetchListingPhotoSource, optimizeListingPhoto } from "@/lib/listing-photo-optimize";
import { requireBlobStorage } from "@/lib/upload";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * After a direct Blob PUT, fetch the stored original, resize/encode JPEG, and
 * return the optimized URL. If optimize fails, keep the original so the photo stays.
 */
export async function POST(req: NextRequest) {
  const access = await requireListingPhotoUploadAccess(req);
  if (!access.ok) return access.response;

  let body: { url?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const sourceUrl = typeof body.url === "string" ? body.url.trim() : "";
  if (!sourceUrl || !isManagedListingPhotoUrl(sourceUrl)) {
    return NextResponse.json({ error: "Invalid photo URL" }, { status: 400 });
  }

  let raw: Buffer;
  try {
    raw = await fetchListingPhotoSource(sourceUrl);
  } catch (e) {
    console.error("[upload listing optimize] fetch", e);
    return NextResponse.json({ url: sourceUrl, optimized: false });
  }

  let optimized: Buffer;
  try {
    optimized = await optimizeListingPhoto(raw);
  } catch (e) {
    console.error("[upload listing optimize] sharp", e);
    return NextResponse.json({ url: sourceUrl, optimized: false });
  }

  const blobCheck = requireBlobStorage();
  if (!blobCheck.ok) {
    return NextResponse.json({ url: sourceUrl, optimized: false });
  }

  const filename = `listing/${access.userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
  try {
    if (process.env.BLOB_READ_WRITE_TOKEN) {
      const blob = await put(filename, optimized, {
        access: "public",
        addRandomSuffix: false,
        contentType: "image/jpeg",
      });
      return NextResponse.json({ url: blob.url, optimized: true });
    }
    return NextResponse.json({ url: sourceUrl, optimized: false });
  } catch (e) {
    console.error("[upload listing optimize] put", e);
    return NextResponse.json({ url: sourceUrl, optimized: false });
  }
}
