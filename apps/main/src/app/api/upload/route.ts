import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { getSessionForApi } from "@/lib/mobile-auth";
import { requireBlobStorage } from "@/lib/upload";
import { prisma } from "database";
import path from "path";
import fs from "fs/promises";

const MAX_SIZE = 40 * 1024 * 1024; // 40MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [sub, member] = await Promise.all([
    prisma.subscription.findFirst({
      where: { memberId: session.user.id, plan: { in: ["sponsor", "seller", "subscribe"] }, status: "active" },
    }),
    prisma.member.findUnique({
      where: { id: session.user.id },
      select: { signupIntent: true },
    }),
  ]);
  const isSignupFlow = !sub && !!member?.signupIntent && ["business", "seller"].includes(member.signupIntent);
  if (!sub && !isSignupFlow) {
    return NextResponse.json({ error: "Sponsor, Seller, or Subscribe plan required" }, { status: 403 });
  }

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "File too large (max 40MB)" }, { status: 400 });
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: "Invalid file type. Use JPEG, PNG, WebP, or GIF." }, { status: 400 });
  }

  const ext = path.extname(file.name) || ".jpg";
  const filename = `business/${session.user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;

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
      return NextResponse.json({ url: blob.url });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const publicDir = path.join(process.cwd(), "public", "uploads");
    const fullPath = path.join(publicDir, filename);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, buffer);
    const url = `/uploads/${filename}`;
    return NextResponse.json({ url });
  } catch (e) {
    console.error("[upload]", e);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
