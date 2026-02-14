import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import QRCode from "qrcode";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import path from "path";
import fs from "fs/promises";
import sharp from "sharp";

const BASE_URL = process.env.NEXTAUTH_URL ?? "http://localhost:3000";

/** 72 PDF points per inch */
const PT_PER_IN = 72;

/** Page background – matches NWC logo (light beige) */
const PAGE_BG = rgb(248 / 255, 231 / 255, 201 / 255); // #F8E7C9
const WHITE = rgb(1, 1, 1);
const BLACK = rgb(0, 0, 0);

const FLYER_TEXT =
  "Is in Partnership with Northwest Community to make Locally Owned Businesses thrive in our area. Scan the QR CODE to earn points to spend on local goods. Thank you for supporting our locally owned companies.";

function wrapText(
  text: string,
  maxWidth: number,
  font: { widthOfTextAtSize: (t: string, size: number) => number },
  fontSize: number
): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
      line = candidate;
    } else {
      if (line) lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Resolve path to NWC logo (same for every flyer). */
async function readNwcLogo(): Promise<Uint8Array | null> {
  const cwd = process.cwd();
  // From compiled route: .next/server/app/api/businesses/[id]/flyer -> 7 levels up = app root (apps/main)
  const fromRoute =
    typeof __dirname !== "undefined"
      ? path.join(__dirname, "..", "..", "..", "..", "..", "..", "..", "public", "nwc-logo-circle.png")
      : "";
  const candidates = [
    path.join(cwd, "public", "nwc-logo-circle.png"),
    path.join(cwd, "apps", "main", "public", "nwc-logo-circle.png"),
    fromRoute,
  ].filter(Boolean);
  for (const p of candidates) {
    try {
      await fs.access(p);
      return new Uint8Array(await fs.readFile(p));
    } catch {
      continue;
    }
  }
  return null;
}

/** Replace near-white pixels in logo with page tan (#F8E7C9) so corners match the flyer. */
const TAN_R = 248;
const TAN_G = 231;
const TAN_B = 201;
const WHITE_THRESHOLD = 250;

async function logoWhiteToTan(bytes: Uint8Array): Promise<Uint8Array> {
  try {
    const { data, info } = await sharp(bytes)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const channels = info.channels;
    for (let i = 0; i < data.length; i += channels) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (r >= WHITE_THRESHOLD && g >= WHITE_THRESHOLD && b >= WHITE_THRESHOLD) {
        data[i] = TAN_R;
        data[i + 1] = TAN_G;
        data[i + 2] = TAN_B;
      }
    }
    const out = await sharp(data, {
      raw: { width: info.width, height: info.height, channels: info.channels },
    })
      .png()
      .toBuffer();
    return new Uint8Array(out);
  } catch {
    return bytes;
  }
}

/** Embed image bytes as PNG or JPEG (file may have wrong extension). */
async function embedLogoImage(
  doc: PDFDocument,
  bytes: Uint8Array
): Promise<Awaited<ReturnType<PDFDocument["embedPng"]>> | null> {
  try {
    const buf = bytes as Buffer;
    const isJpeg = buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    if (isJpeg) {
      return await doc.embedJpg(bytes);
    }
    return await doc.embedPng(bytes);
  } catch {
    return null;
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sub = await prisma.subscription.findFirst({
    where: { memberId: session.user.id, plan: { in: ["sponsor", "seller"] }, status: "active" },
  });
  if (!sub) {
    return NextResponse.json({ error: "Sponsor or Seller plan required" }, { status: 403 });
  }

  const { id } = await params;
  const business = await prisma.business.findFirst({
    where: { id, memberId: session.user.id },
  });
  if (!business) {
    return NextResponse.json({ error: "Business not found" }, { status: 404 });
  }

  try {
    const nwcLogoBytes = await readNwcLogo();
    const url = `${BASE_URL}/scan/${business.id}`;
    const qrPng = await QRCode.toBuffer(url, { width: 400, margin: 2 });

    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]); // US Letter

    page.drawRectangle({
      x: 0,
      y: 0,
      width: 612,
      height: 792,
      color: PAGE_BG,
    });

    const font = await doc.embedFont(StandardFonts.Helvetica);
    const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

    const pageWidth = 612;
    const marginSide = 56;
    const marginTop = 36;
    const marginBottom = 36;
    const contentWidth = pageWidth - marginSide * 2;
    const availableHeight = 792 - marginTop - marginBottom;

    // Sizes: logo, title, paragraph (22pt), QR (20% smaller), footer
    const logoSizePt = 3.5 * PT_PER_IN;
    const titleSize = 31;
    const bodySize = 22; // decreased by 2 from 24
    const qrSizePt = 3.35 * PT_PER_IN * 0.8; // 20% smaller
    const pnwSize = 21;
    const appSize = 14;

    // Paragraph starts with "Is in Partnership..." (no business name)
    const bodyText = FLYER_TEXT;
    const bodyLines = wrapText(bodyText, contentWidth, font, bodySize);
    const lineHeight = bodySize * 1.15;
    const paragraphHeight = bodyLines.length * lineHeight;
    const headerHeight = titleSize * 1.1;
    const footerHeight = pnwSize * 1.2 + 8 + appSize;
    const footerTopY = marginBottom + appSize + (appSize * 1.2 + 8) + pnwSize; // top of PNW text

    let y = 792 - marginTop;

    // 1. Logo – centered; white corners replaced with tan
    if (nwcLogoBytes) {
      const logoProcessed = await logoWhiteToTan(nwcLogoBytes);
      const nwcLogo = await embedLogoImage(doc, logoProcessed);
      if (nwcLogo) {
        page.drawImage(nwcLogo, {
          x: (pageWidth - logoSizePt) / 2,
          y: y - logoSizePt,
          width: logoSizePt,
          height: logoSizePt,
        });
      }
    }
    // Gap after logo – balanced so name sits clearly below
    y -= logoSizePt + 40;

    // 2. Business name – 31pt Helvetica Bold; moderate space above paragraph
    const titleWidth = fontBold.widthOfTextAtSize(business.name, titleSize);
    page.drawText(business.name, {
      x: (pageWidth - titleWidth) / 2,
      y,
      size: titleSize,
      font: fontBold,
      color: BLACK,
    });
    // Single line spacing; move paragraph up 14
    y -= lineHeight + bodySize - 14;

    // 3. Paragraph – 22pt, "Is in Partnership...", centered (Helvetica)
    for (const line of bodyLines) {
      const lineWidth = font.widthOfTextAtSize(line, bodySize);
      page.drawText(line, {
        x: (pageWidth - lineWidth) / 2,
        y,
        size: bodySize,
        font,
        color: BLACK,
      });
      y -= lineHeight;
    }
    const paragraphEndY = y;
    const paragraphTopOfLastLineY = paragraphEndY + bodySize; // top of last line for even visual spacing

    // 4. QR code – centered so gap(paragraph top-of-last-line → QR top) = gap(QR bottom → website top)
    const spaceForQr = paragraphTopOfLastLineY - footerTopY;
    const qrY = footerTopY + Math.max(0, (spaceForQr - qrSizePt) / 2);
    const qrImage = await doc.embedPng(qrPng);
    page.drawImage(qrImage, {
      x: (pageWidth - qrSizePt) / 2,
      y: qrY,
      width: qrSizePt,
      height: qrSizePt,
    });

    // 5. Website + App store – fixed at bottom, original spacing between the two lines
    const appBaselineY = marginBottom + appSize;
    const pnwBaselineY = appBaselineY + appSize * 1.2 + 8;
    const pnw = "PNWCOMMUNITY.COM";
    const pnwWidth = fontBold.widthOfTextAtSize(pnw, pnwSize);
    page.drawText(pnw, {
      x: (pageWidth - pnwWidth) / 2,
      y: pnwBaselineY,
      size: pnwSize,
      font: fontBold,
      color: BLACK,
    });

    const appLine = "APP STORE: Northwest Community";
    const appWidth = fontBold.widthOfTextAtSize(appLine, appSize);
    page.drawText(appLine, {
      x: (pageWidth - appWidth) / 2,
      y: appBaselineY,
      size: appSize,
      font: fontBold,
      color: BLACK,
    });

  const pdfBytes = await doc.save();

  return new NextResponse(new Uint8Array(pdfBytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="nwc-flyer-${business.slug}.pdf"`,
    },
  });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : typeof err === "string" ? err : "Failed to generate flyer";
    console.error("[flyer] error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
