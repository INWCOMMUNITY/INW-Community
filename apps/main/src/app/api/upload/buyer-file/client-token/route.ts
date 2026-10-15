import { NextRequest, NextResponse } from "next/server";
import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client";
import { getSessionForApi } from "@/lib/mobile-auth";
import { formatBuyerFileSizeLabel, MAX_BUYER_FILE_BYTES } from "@/lib/upload-limits";

export const runtime = "nodejs";

const ALLOWED = [
  "image/jpeg",
  "image/png",
  "image/svg+xml",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
] as const;

const EXT_TO_MIME: Record<string, (typeof ALLOWED)[number]> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".pdf": "application/pdf",
};

function effectiveMime(rawType: string, fileName: string): string | null {
  const t = rawType.toLowerCase().trim();
  if (t === "image/jpg") return "image/jpeg";
  if ((ALLOWED as readonly string[]).includes(t)) return t;
  const dot = fileName.lastIndexOf(".");
  const ext = dot >= 0 ? fileName.slice(dot).toLowerCase() : "";
  return EXT_TO_MIME[ext] ?? null;
}

function extFor(mime: string, fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  const fromName = dot >= 0 ? fileName.slice(dot).toLowerCase() : "";
  if (/^\.(jpe?g|png|svg|webp|hei[cf]|pdf)$/.test(fromName)) return fromName;
  if (mime === "image/png") return ".png";
  if (mime === "image/svg+xml") return ".svg";
  if (mime === "image/webp") return ".webp";
  if (mime === "image/heic") return ".heic";
  if (mime === "image/heif") return ".heif";
  if (mime === "application/pdf") return ".pdf";
  return ".jpg";
}

/**
 * Short-lived Blob token so custom-option photos skip the ~4.5MB serverless body cap.
 */
export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rw = process.env.BLOB_READ_WRITE_TOKEN;
  if (!rw) {
    return NextResponse.json(
      { error: "Blob storage not configured", code: "USE_MULTIPART_FALLBACK" },
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
  const contentType = effectiveMime(body.contentType ?? "", filenameHint);
  if (!contentType) {
    return NextResponse.json(
      { error: "Use jpg, png, svg, pdf, webp, or heic." },
      { status: 400 }
    );
  }

  const ext = extFor(contentType, filenameHint);
  const pathname = `buyer-files/${session.user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;

  try {
    const clientToken = await generateClientTokenFromReadWriteToken({
      pathname,
      token: rw,
      maximumSizeInBytes: MAX_BUYER_FILE_BYTES,
      allowedContentTypes: [...ALLOWED],
      addRandomSuffix: false,
    });
    return NextResponse.json({
      pathname,
      clientToken,
      contentType,
      maxBytes: MAX_BUYER_FILE_BYTES,
      maxLabel: formatBuyerFileSizeLabel(),
    });
  } catch (error) {
    console.error("[buyer-file client-token]", error);
    return NextResponse.json({ error: "Could not prepare upload" }, { status: 500 });
  }
}
