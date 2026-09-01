import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import {
  PACKING_SLIP_FOOTER,
  PACKING_SLIP_THANKS,
  packingSlipContactLine,
  packingSlipOrderMetaLine,
  packingSlipTotalRows,
  type PackingSlipGroup,
  type PackingSlipSellerProfile,
} from "./packing-slip-shared";

export {
  PACKING_SLIP_FOOTER,
  PACKING_SLIP_THANKS,
  packingSlipGrandTotalCents,
  packingSlipTotalRows,
  type PackingSlipGroup,
  type PackingSlipOrder,
  type PackingSlipSellerProfile,
} from "./packing-slip-shared";

const PT = 72;
const PW = 612;
const PH = 792;
const M = 0.5 * PT;
const CW = PW - M * 2;
const BLACK = rgb(0, 0, 0);
const THIN = 0.4;
const FOOTER_RESERVE = 52;

function fmtShipTo(addr: unknown): string {
  if (!addr || typeof addr !== "object") return "";
  const a = addr as Record<string, string>;
  const parts: string[] = [];
  if (a.street ?? a.address) parts.push((a.street ?? a.address) as string);
  if (a.street2) parts.push(a.street2);
  const csz = [a.city, a.state, a.zip].filter(Boolean).join(", ");
  if (csz) parts.push(csz);
  if (a.country && a.country !== "US") parts.push(a.country);
  return parts.join("\n");
}

type PDFPage = Awaited<ReturnType<PDFDocument["addPage"]>>;
type PDFFont = Awaited<ReturnType<PDFDocument["embedFont"]>>;

function resolveLogoUrl(logoUrl: string): string {
  const trimmed = logoUrl.trim();
  if (!trimmed) return trimmed;
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  const base =
    process.env.NEXTAUTH_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
  return `${base.replace(/\/+$/, "")}${trimmed.startsWith("/") ? "" : "/"}${trimmed}`;
}

async function tryEmbedLogo(doc: PDFDocument, url: string) {
  try {
    const absoluteUrl = resolveLogoUrl(url);
    const res = await fetch(absoluteUrl);
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    const ct = (res.headers.get("content-type") ?? "").toLowerCase();
    const isPng =
      ct.includes("png") ||
      (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47);
    const isJpg =
      ct.includes("jpeg") ||
      ct.includes("jpg") ||
      (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff);
    if (isPng) return await doc.embedPng(bytes);
    if (isJpg) return await doc.embedJpg(bytes);
    return null;
  } catch {
    return null;
  }
}

function drawLine(p: PDFPage, x1: number, y1: number, x2: number, y2: number, lw = 0.75) {
  p.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: lw, color: BLACK });
}

function textLines(text: string, font: PDFFont, size: number, maxW: number): string[] {
  const result: string[] = [];
  for (const raw of text.split("\n")) {
    const words = raw.split(/\s+/);
    let line = "";
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(test, size) > maxW && line) {
        result.push(line);
        line = w;
      } else {
        line = test;
      }
    }
    if (line) result.push(line);
    else result.push("");
  }
  return result;
}

function drawRight(
  p: PDFPage,
  text: string,
  rightX: number,
  y: number,
  size: number,
  font: PDFFont
) {
  const w = font.widthOfTextAtSize(text, size);
  p.drawText(text, { x: rightX - w, y, size, font, color: BLACK });
}

export async function generatePackingSlipPdf(
  groups: PackingSlipGroup[],
  sellerProfile: PackingSlipSellerProfile
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fontItalic = await doc.embedFont(StandardFonts.HelveticaOblique);

  const biz = sellerProfile.business;
  const bizName = biz?.name?.trim() || "Packing slip";
  const returnAddress = sellerProfile.returnAddressFormatted?.trim() || "—";
  const contact = packingSlipContactLine(biz);
  const note = sellerProfile.packingSlipNote?.trim() ?? "";
  const logo = biz?.logoUrl ? await tryEmbedLogo(doc, biz.logoUrl) : null;

  const qtyW = 36;
  const unitW = 72;
  const lineW = 72;
  const nameW = CW - qtyW - unitW - lineW;
  const unitX = M + qtyW + nameW;
  const lineX = M + CW;

  for (const group of groups) {
    const groupPages: PDFPage[] = [];
    let page!: PDFPage;
    let y = 0;

    const addPage = () => {
      page = doc.addPage([PW, PH]);
      groupPages.push(page);
      y = PH - M;
    };

    const contentFloor = () => M + FOOTER_RESERVE;

    const drawTableHeader = () => {
      page.drawText("Qty", { x: M, y, size: 8, font: fontBold, color: BLACK });
      page.drawText("Item", { x: M + qtyW, y, size: 8, font: fontBold, color: BLACK });
      drawRight(page, "Unit price", unitX + unitW, y, 8, fontBold);
      drawRight(page, "Line total", lineX, y, 8, fontBold);
      y -= 5;
      drawLine(page, M, y, M + CW, y, 0.75);
      y -= 12;
    };

    const drawContinuationHeader = () => {
      page.drawText(`${bizName}  —  ${packingSlipOrderMetaLine(group)} (continued)`, {
        x: M,
        y,
        size: 8,
        font,
        color: BLACK,
      });
      y -= 10;
      drawLine(page, M, y, M + CW, y, 0.75);
      y -= 16;
    };

    const ensureSpace = (needed: number, continued = true) => {
      if (y - needed >= contentFloor()) return;
      addPage();
      if (continued) drawContinuationHeader();
    };

    addPage();

    const logoSize = 64;
    const textX = logo ? M + logoSize + 14 : M;
    const textW = logo ? CW - logoSize - 14 : CW;
    let textY = y - 12;

    page.drawText(bizName, { x: textX, y: textY, size: 14, font: fontBold, color: BLACK });
    textY -= 16;
    if (contact) {
      const contactLines = textLines(contact, font, 8, textW);
      for (const cl of contactLines) {
        page.drawText(cl, { x: textX, y: textY, size: 8, font, color: BLACK });
        textY -= 11;
      }
    }
    if (note) {
      textY -= 4;
      const noteLines = textLines(note, fontItalic, 8, textW).slice(0, 6);
      for (const nl of noteLines) {
        page.drawText(nl, { x: textX, y: textY, size: 8, font: fontItalic, color: BLACK });
        textY -= 11;
      }
    }

    if (logo) {
      const { width: iw, height: ih } = logo.scale(1);
      const inset = 3;
      const box = logoSize - inset * 2;
      const scale = box / Math.max(iw, ih);
      const dw = iw * scale;
      const dh = ih * scale;
      const logoY = y - logoSize;
      page.drawRectangle({
        x: M,
        y: logoY,
        width: logoSize,
        height: logoSize,
        borderColor: BLACK,
        borderWidth: 0.6,
        color: undefined,
      });
      page.drawImage(logo, {
        x: M + inset + (box - dw) / 2,
        y: logoY + inset + (box - dh) / 2,
        width: dw,
        height: dh,
      });
    }

    y = Math.min(logo ? y - logoSize : y, textY) - 14;

    page.drawText(packingSlipOrderMetaLine(group), { x: M, y, size: 9, font, color: BLACK });
    y -= 12;
    drawLine(page, M, y, M + CW, y, 0.75);
    y -= 16;

    const colW = (CW - 24) / 2;
    const labelSize = 7;
    page.drawText("RETURN ADDRESS", { x: M, y, size: labelSize, font: fontBold, color: BLACK });
    page.drawText("SHIP TO", { x: M + colW + 24, y, size: labelSize, font: fontBold, color: BLACK });
    y -= 13;

    const returnLines = textLines(returnAddress, font, 9, colW);
    const buyerName = `${group.buyer.firstName} ${group.buyer.lastName}`.trim();
    const shipLines = [
      buyerName,
      ...textLines(fmtShipTo(group.orders[0]?.shippingAddress) || "—", font, 9, colW),
    ];
    const addrCount = Math.max(returnLines.length, shipLines.length);
    for (let i = 0; i < addrCount; i++) {
      const ret = returnLines[i];
      const ship = shipLines[i];
      if (ret) page.drawText(ret, { x: M, y, size: 9, font, color: BLACK });
      if (ship) {
        page.drawText(ship, {
          x: M + colW + 24,
          y,
          size: 9,
          font: i === 0 ? fontBold : font,
          color: BLACK,
        });
      }
      y -= 12;
    }

    y -= 8;
    drawLine(page, M, y, M + CW, y, 0.75);
    y -= 16;

    drawTableHeader();

    for (const oi of group.combinedItems) {
      const title = oi.storeItem.title?.trim() || "Item";
      const titleLines = textLines(title, font, 9, nameW);
      const rowH = Math.max(14, titleLines.length * 12) + 6;
      ensureSpace(rowH);
      page.drawText(String(oi.quantity), { x: M, y, size: 9, font, color: BLACK });
      let ty = y;
      for (const tl of titleLines) {
        page.drawText(tl, { x: M + qtyW, y: ty, size: 9, font, color: BLACK });
        ty -= 12;
      }
      const unitStr = `$${(oi.priceCentsAtPurchase / 100).toFixed(2)}`;
      const lineStr = `$${((oi.priceCentsAtPurchase * oi.quantity) / 100).toFixed(2)}`;
      drawRight(page, unitStr, unitX + unitW, y, 9, font);
      drawRight(page, lineStr, lineX, y, 9, font);
      y = Math.min(y, ty) - 4;
      drawLine(page, M, y, M + CW, y, THIN);
      y -= 10;
    }

    const totalRows = packingSlipTotalRows(group);
    const totalsH = 10 + totalRows.length * 14 + 8;
    ensureSpace(totalsH);
    y -= 6;

    const totalsW = 200;
    const totalsRight = M + CW;
    const totalsLeft = totalsRight - totalsW;

    for (const row of totalRows) {
      if (row.emphasis) {
        drawLine(page, totalsLeft, y + 10, totalsRight, y + 10, 0.75);
        y -= 4;
      }
      const rowFont = row.emphasis ? fontBold : font;
      const rowSize = row.emphasis ? 11 : 9;
      page.drawText(row.label, { x: totalsLeft, y, size: rowSize, font: rowFont, color: BLACK });
      drawRight(page, row.value, totalsRight, y, rowSize, rowFont);
      y -= 14;
    }

    const n = groupPages.length;
    for (let i = 0; i < n; i++) {
      const p = groupPages[i]!;
      const footerY = M + 18;
      drawLine(p, M, footerY + 22, M + CW, footerY + 22, 0.6);
      const thanksW = font.widthOfTextAtSize(PACKING_SLIP_THANKS, 8);
      p.drawText(PACKING_SLIP_THANKS, {
        x: M + (CW - thanksW) / 2,
        y: footerY + 8,
        size: 8,
        font,
        color: BLACK,
      });
      p.drawText(PACKING_SLIP_FOOTER, { x: M, y: footerY - 6, size: 8, font, color: BLACK });
      if (n > 1) {
        drawRight(p, `Page ${i + 1} of ${n}`, M + CW, footerY - 6, 8, font);
      }
    }
  }

  const pdfBytes = await doc.save();
  return new Uint8Array(pdfBytes);
}
