import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import path from "path";
import fs from "fs/promises";
import sharp from "sharp";
import QRCode from "qrcode";

/** 72 PDF points per inch */
const PT_PER_IN = 72;

/** Brand palette (matches design tokens). */
const PAGE_BG = rgb(248 / 255, 231 / 255, 201 / 255); // #F8E7C9
const FOOTER_BAND = rgb(253 / 255, 237 / 255, 204 / 255); // #FDEDCC
const HEADING = rgb(62 / 255, 67 / 255, 47 / 255); // #3E432F
const BODY = rgb(80 / 255, 85 / 255, 66 / 255); // #505542
const ACCENT = rgb(93 / 255, 79 / 255, 64 / 255); // #5d4f40

const FLYER_LINE_1 = "is a proud partner of Northwest Community.";
const FLYER_LINE_2 =
  "Together we champion locally owned businesses across the Inland Northwest.";
const FLYER_FEATURES =
  "Shop Locally Online - Local Business Directory - Exclusive Community Social Media - Community Calendars";

const SITE_LABEL = "INWCOMMUNITY.COM";
const APP_LABEL = "Get the INW Community app";
const APP_DOWNLOAD_URL = "https://www.inwcommunity.com/download-app";

/** Gaps (PDF points). Logo stays top-pinned; name sits clearly below it. */
const GAP_TOP_TO_LOGO = 28;
const GAP_LOGO_TO_NAME = 64;
const GAP_NAME_TO_BODY = 20;
const BODY_LINE_GAP = 6;
const GAP_BODY_TO_DASHES = 16;
const GAP_DASHES_TO_FEATURES = 14;
const FEATURE_LINE_GAP = 5;

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

/** Shrink title until it fits one line, then allow wrap for very long names. */
function fitBusinessName(
  name: string,
  maxWidth: number,
  font: PDFFont,
  preferredSize: number,
  minSize: number
): { lines: string[]; size: number } {
  let size = preferredSize;
  while (size > minSize && font.widthOfTextAtSize(name, size) > maxWidth) {
    size -= 1;
  }
  if (font.widthOfTextAtSize(name, size) <= maxWidth) {
    return { lines: [name], size };
  }
  return { lines: wrapText(name, maxWidth, font, size), size };
}

function drawCenteredText(
  page: PDFPage,
  text: string,
  args: { y: number; size: number; font: PDFFont; color: ReturnType<typeof rgb>; pageWidth: number }
) {
  const width = args.font.widthOfTextAtSize(text, args.size);
  page.drawText(text, {
    x: (args.pageWidth - width) / 2,
    y: args.y,
    size: args.size,
    font: args.font,
    color: args.color,
  });
}

async function readPublicFile(...segments: string[]): Promise<Uint8Array | null> {
  const cwd = process.cwd();
  const fromRoute =
    typeof __dirname !== "undefined"
      ? path.join(__dirname, "..", "..", "..", "..", "..", "..", "..", "public", ...segments)
      : "";
  const candidates = [
    path.join(cwd, "public", ...segments),
    path.join(cwd, "apps", "main", "public", ...segments),
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

async function readNwcLogo(): Promise<Uint8Array | null> {
  return readPublicFile("nwc-logo-circle.png");
}

async function readFahkwangFonts(): Promise<{ regular: Uint8Array; bold: Uint8Array } | null> {
  const regular = await readPublicFile("fonts", "fahkwang", "Fahkwang-Regular.ttf");
  const bold =
    (await readPublicFile("fonts", "fahkwang", "Fahkwang-Bold.ttf")) ??
    (await readPublicFile("fonts", "fahkwang", "Fahkwang-SemiBold.ttf"));
  if (!regular || !bold) return null;
  return { regular, bold };
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

  const { hasBusinessHubAccess } = await import("@/lib/business-hub-access");
  if (!(await hasBusinessHubAccess(session.user.id))) {
    return NextResponse.json({ error: "Business Hub access required" }, { status: 403 });
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
    const fahkwangBytes = await readFahkwangFonts();
    if (!fahkwangBytes) {
      return NextResponse.json({ error: "Flyer fonts are not available" }, { status: 500 });
    }

    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    const page = doc.addPage([612, 792]); // US Letter
    const pageWidth = 612;
    const pageHeight = 792;

    page.drawRectangle({
      x: 0,
      y: 0,
      width: pageWidth,
      height: pageHeight,
      color: PAGE_BG,
    });

    // Soft olive bars top / bottom
    const barH = 10;
    page.drawRectangle({ x: 0, y: pageHeight - barH, width: pageWidth, height: barH, color: ACCENT });
    page.drawRectangle({ x: 0, y: 0, width: pageWidth, height: barH, color: ACCENT });

    const font = await doc.embedFont(fahkwangBytes.regular);
    const fontBold = await doc.embedFont(fahkwangBytes.bold);

    const marginSide = 64;
    const contentWidth = pageWidth - marginSide * 2;
    const logoSizePt = 2.25 * PT_PER_IN;
    const bodySize = 17;
    const siteSize = 16;
    const appSize = 13;
    const qrSizePt = 96;

    const footerPad = 22;
    const footerInnerH = qrSizePt + appSize + siteSize + 36;
    const footerH = footerInnerH + footerPad * 2;
    const footerY = barH;

    // Footer band
    page.drawRectangle({
      x: 0,
      y: footerY,
      width: pageWidth,
      height: footerH,
      color: FOOTER_BAND,
    });
    page.drawRectangle({
      x: marginSide,
      y: footerY + footerH - 1,
      width: contentWidth,
      height: 1,
      color: ACCENT,
    });

    // Logo pinned to top (not vertically centered).
    let y = pageHeight - barH - GAP_TOP_TO_LOGO;

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

    const title = fitBusinessName(business.name, contentWidth, fontBold, 32, 22);
    const titleLineH = title.size * 1.12;
    // Decent space from logo bottom to name baseline.
    y -= logoSizePt + GAP_LOGO_TO_NAME;

    for (const line of title.lines) {
      drawCenteredText(page, line, {
        y,
        size: title.size,
        font: fontBold,
        color: HEADING,
        pageWidth,
      });
      y -= titleLineH;
    }

    y -= GAP_NAME_TO_BODY;
    const bodyParagraphs = [FLYER_LINE_1, FLYER_LINE_2];
    const bodyLineH = bodySize + BODY_LINE_GAP;
    for (const paragraph of bodyParagraphs) {
      const wrapped = wrapText(paragraph, contentWidth, font, bodySize);
      for (const line of wrapped) {
        drawCenteredText(page, line, {
          y,
          size: bodySize,
          font,
          color: BODY,
          pageWidth,
        });
        y -= bodyLineH;
      }
    }

    // Three dashes, then feature list
    y -= GAP_BODY_TO_DASHES;
    drawCenteredText(page, "— — —", {
      y,
      size: bodySize,
      font: fontBold,
      color: ACCENT,
      pageWidth,
    });
    y -= bodySize + GAP_DASHES_TO_FEATURES;

    const featureSize = 14;
    const featureLines = wrapText(FLYER_FEATURES, contentWidth, font, featureSize);
    const featureLineH = featureSize + FEATURE_LINE_GAP;
    for (const line of featureLines) {
      drawCenteredText(page, line, {
        y,
        size: featureSize,
        font,
        color: HEADING,
        pageWidth,
      });
      y -= featureLineH;
    }

    // Footer: site → app label → QR
    let footY = footerY + footerPad + qrSizePt + 14 + appSize + 10;

    // Site with light tracking via spaced characters
    const siteTracked = SITE_LABEL.split("").join(" ");
    drawCenteredText(page, siteTracked, {
      y: footY,
      size: siteSize,
      font: fontBold,
      color: HEADING,
      pageWidth,
    });
    footY -= appSize + 10;

    drawCenteredText(page, APP_LABEL, {
      y: footY,
      size: appSize,
      font,
      color: BODY,
      pageWidth,
    });

    const qrPng = await QRCode.toBuffer(APP_DOWNLOAD_URL, {
      width: 280,
      margin: 1,
      color: { dark: "#3E432F", light: "#FDEDCC" },
      errorCorrectionLevel: "M",
    });
    const qrImage = await doc.embedPng(new Uint8Array(qrPng));
    page.drawImage(qrImage, {
      x: (pageWidth - qrSizePt) / 2,
      y: footerY + footerPad,
      width: qrSizePt,
      height: qrSizePt,
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
