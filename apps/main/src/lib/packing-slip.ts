/** Shared branding for packing slips (website print + mobile app PDF). */
export const PACKING_SLIP_FOOTER = "- inwcommunity.com";

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const PT = 72; // points per inch
const PW = 612; // 8.5in
const PH = 792; // 11in
const M = 0.4 * PT; // margin
const CW = PW - M * 2; // content width
const BLACK = rgb(0, 0, 0);
const LINE_W = 1;
const THIN = 0.5;

export interface PackingSlipGroup {
  buyer: { firstName: string; lastName: string; email: string };
  orders: Array<{ id: string; shippingAddress: unknown }>;
  combinedItems: Array<{
    id: string;
    quantity: number;
    priceCentsAtPurchase: number;
    storeItem: { title: string };
    orderId: string;
  }>;
  totalCents: number;
  subtotalCents: number;
  shippingCostCents: number;
  taxCents?: number;
}

export interface PackingSlipSellerProfile {
  business: {
    name: string;
    phone: string | null;
    address: string | null;
    city?: string | null;
    logoUrl: string | null;
    website?: string | null;
    email?: string | null;
  } | null;
  /** EasyPost return address (used for return-address box only; not the app business address). */
  returnAddressFormatted: string | null;
  packingSlipNote?: string | null;
}

function fmtAddr(addr: string | null, city?: string | null): string {
  if (!addr?.trim()) return "";
  const lines = addr.split(/\n/).map((l) => l.trim()).filter(Boolean);
  if (city?.trim()) lines.push(city.trim());
  return lines.join("\n");
}

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

/** Resolve relative logo URLs (e.g. /uploads/...) to absolute so server-side fetch works. */
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
    // Detect by magic bytes if content-type is missing or generic
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

function drawRect(p: PDFPage, x: number, y: number, w: number, h: number, lw = LINE_W) {
  p.drawRectangle({ x, y, width: w, height: h, borderColor: BLACK, borderWidth: lw, color: undefined });
}

function drawLine(p: PDFPage, x1: number, y1: number, x2: number, _y2: number, lw = LINE_W * 2) {
  p.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: _y2 }, thickness: lw, color: BLACK });
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

function drawWrapped(
  p: PDFPage, text: string, x: number, y: number,
  font: PDFFont, size: number, maxW: number
): number {
  const lines = textLines(text, font, size, maxW);
  let cy = y;
  for (const line of lines) {
    p.drawText(line, { x, y: cy, size, font, color: BLACK });
    cy -= size * 1.4;
  }
  return cy;
}

export async function generatePackingSlipPdf(
  groups: PackingSlipGroup[],
  sellerProfile: PackingSlipSellerProfile
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const biz = sellerProfile.business;
  const bizName = biz?.name ?? "Business";
  const returnAddress = sellerProfile.returnAddressFormatted?.trim() || "—";

  const logo = biz?.logoUrl ? await tryEmbedLogo(doc, biz.logoUrl) : null;

  for (const group of groups) {
    const page = doc.addPage([PW, PH]);
    let y = PH - M;

    // ── Header: Logo (left) + Note box & Website/Email boxes (right) ──
    const logoSize = 90;
    const logoX = M;
    const logoY = y - logoSize;
    const rightX = M + logoSize + 16;
    const rightW = CW - logoSize - 16;

    if (logo) {
      const { width: iw, height: ih } = logo.scale(1);
      const scale = logoSize / Math.max(iw, ih);
      const dw = iw * scale;
      const dh = ih * scale;
      const cx = logoX + logoSize / 2;
      const cy = logoY + logoSize / 2;
      page.drawImage(logo, { x: cx - dw / 2, y: cy - dh / 2, width: dw, height: dh });
    }
    // Circle border around logo area
    page.drawCircle({ x: logoX + logoSize / 2, y: logoY + logoSize / 2, size: logoSize / 2, borderColor: BLACK, borderWidth: LINE_W * 1.5, color: undefined });
    if (!logo) {
      const lbl = "Business Logo";
      const tw = font.widthOfTextAtSize(lbl, 8);
      page.drawText(lbl, { x: logoX + (logoSize - tw) / 2, y: logoY + logoSize / 2 - 4, size: 8, font, color: BLACK });
    }

    // Note box
    const noteBoxH = 52;
    const noteBoxY = y - noteBoxH;
    drawRect(page, rightX, noteBoxY, rightW, noteBoxH);
    page.drawText(`A Note from ${bizName}`, { x: rightX + 8, y: noteBoxY + noteBoxH - 14, size: 9, font: fontBold, color: BLACK });
    const noteText = sellerProfile.packingSlipNote?.trim() || "—";
    const noteLines = textLines(noteText.slice(0, 250), font, 8, rightW - 16);
    let ny = noteBoxY + noteBoxH - 28;
    for (const nl of noteLines.slice(0, 3)) {
      page.drawText(nl, { x: rightX + 8, y: ny, size: 8, font, color: BLACK });
      ny -= 11;
    }

    // Website & Email boxes
    const smallBoxH = 32;
    const smallBoxY = noteBoxY - 6 - smallBoxH;
    const halfW = (rightW - 6) / 2;

    drawRect(page, rightX, smallBoxY, halfW, smallBoxH);
    page.drawText("Sellers Website", { x: rightX + 6, y: smallBoxY + smallBoxH - 11, size: 7, font: fontBold, color: BLACK });
    const webText = biz?.website ?? "—";
    page.drawText(webText.slice(0, 35), { x: rightX + 6, y: smallBoxY + 6, size: 8, font, color: BLACK });

    drawRect(page, rightX + halfW + 6, smallBoxY, halfW, smallBoxH);
    page.drawText("Sellers Email", { x: rightX + halfW + 12, y: smallBoxY + smallBoxH - 11, size: 7, font: fontBold, color: BLACK });
    const emailText = biz?.email ?? "—";
    page.drawText(emailText.slice(0, 35), { x: rightX + halfW + 12, y: smallBoxY + 6, size: 8, font, color: BLACK });

    y = Math.min(logoY, smallBoxY) - 12;

    // ── Separator ──
    drawLine(page, M, y, M + CW, y, 2);
    y -= 16;

    // ── Return Address | Shipping Address side-by-side boxes ──
    const addrBoxW = (CW - 12) / 2;
    const addrBoxH = 80;
    const addrBoxY = y - addrBoxH;

    drawRect(page, M, addrBoxY, addrBoxW, addrBoxH, 1.5);
    page.drawText("RETURN ADDRESS", { x: M + 10, y: addrBoxY + addrBoxH - 16, size: 8, font: fontBold, color: BLACK });
    drawWrapped(page, returnAddress || "—", M + 10, addrBoxY + addrBoxH - 30, font, 9, addrBoxW - 20);

    const shipBoxX = M + addrBoxW + 12;
    drawRect(page, shipBoxX, addrBoxY, addrBoxW, addrBoxH, 1.5);
    page.drawText("SHIPPING ADDRESS", { x: shipBoxX + 10, y: addrBoxY + addrBoxH - 16, size: 8, font: fontBold, color: BLACK });
    const buyerName = `${group.buyer.firstName} ${group.buyer.lastName}`;
    page.drawText(buyerName, { x: shipBoxX + 10, y: addrBoxY + addrBoxH - 30, size: 9, font: fontBold, color: BLACK });
    const shipAddr = fmtShipTo(group.orders[0]?.shippingAddress);
    drawWrapped(page, shipAddr || "—", shipBoxX + 10, addrBoxY + addrBoxH - 44, font, 9, addrBoxW - 20);

    y = addrBoxY - 12;

    // ── Separator ──
    drawLine(page, M, y, M + CW, y, 2);
    y -= 20;

    // ── Item table ──
    const qtyColW = 60;
    const priceColW = 80;
    const nameColW = CW - qtyColW - priceColW;

    page.drawText("Quantity", { x: M, y, size: 9, font: fontBold, color: BLACK });
    page.drawText("Item Name", { x: M + qtyColW, y, size: 9, font: fontBold, color: BLACK });
    page.drawText("Price Per Item", { x: M + CW - priceColW, y, size: 9, font: fontBold, color: BLACK });
    y -= 6;
    drawLine(page, M, y, M + CW, y, 1.5);
    y -= 14;

    for (const oi of group.combinedItems) {
      page.drawText(String(oi.quantity), { x: M, y, size: 9, font, color: BLACK });
      const title = oi.storeItem.title.length > 50 ? oi.storeItem.title.slice(0, 47) + "..." : oi.storeItem.title;
      page.drawText(title, { x: M + qtyColW, y, size: 9, font, color: BLACK });
      const priceStr = `$${(oi.priceCentsAtPurchase / 100).toFixed(2)}`;
      const priceW = font.widthOfTextAtSize(priceStr, 9);
      page.drawText(priceStr, { x: M + CW - priceW, y, size: 9, font, color: BLACK });
      y -= 4;
      drawLine(page, M, y, M + CW, y, THIN);
      y -= 14;
    }

    y -= 4;

    // ── Shipping Cost, Tax, Total boxes (right-aligned) ──
    const boxW = 90;
    const boxH = 36;
    const boxGap = 8;

    const hasTax = group.taxCents && group.taxCents > 0;
    const numBoxes = hasTax ? 3 : 2;
    const totalBoxesW = numBoxes * boxW + (numBoxes - 1) * boxGap;
    let bx = M + CW - totalBoxesW;
    const boxY = y - boxH;

    // Shipping Cost
    drawRect(page, bx, boxY, boxW, boxH, 1.5);
    page.drawText("Shipping Cost", { x: bx + 6, y: boxY + boxH - 12, size: 7, font: fontBold, color: BLACK });
    const shipStr = `$${(group.shippingCostCents / 100).toFixed(2)}`;
    const shipW = font.widthOfTextAtSize(shipStr, 9);
    page.drawText(shipStr, { x: bx + boxW - shipW - 6, y: boxY + 8, size: 9, font: fontBold, color: BLACK });
    bx += boxW + boxGap;

    // Tax (if applicable)
    if (hasTax) {
      drawRect(page, bx, boxY, boxW, boxH, 1.5);
      page.drawText("Tax", { x: bx + 6, y: boxY + boxH - 12, size: 7, font: fontBold, color: BLACK });
      const taxStr = `$${(group.taxCents! / 100).toFixed(2)}`;
      const taxW = font.widthOfTextAtSize(taxStr, 9);
      page.drawText(taxStr, { x: bx + boxW - taxW - 6, y: boxY + 8, size: 9, font: fontBold, color: BLACK });
      bx += boxW + boxGap;
    }

    // Total
    drawRect(page, bx, boxY, boxW, boxH, 1.5);
    page.drawText("Total", { x: bx + 6, y: boxY + boxH - 12, size: 7, font: fontBold, color: BLACK });
    const totalStr = `$${(group.totalCents / 100).toFixed(2)}`;
    const totalW = fontBold.widthOfTextAtSize(totalStr, 10);
    page.drawText(totalStr, { x: bx + boxW - totalW - 6, y: boxY + 8, size: 10, font: fontBold, color: BLACK });

    // ── Footer at bottom of page ──
    const footerY = M + 40;
    drawLine(page, M, footerY + 24, M + CW, footerY + 24, 2);
    const tyMsg = "Thank you for Supporting Locally Owned Businesses!";
    const tyW = fontBold.widthOfTextAtSize(tyMsg, 13);
    page.drawText(tyMsg, { x: M + (CW - tyW) / 2, y: footerY + 6, size: 13, font: fontBold, color: BLACK });
    const footW = font.widthOfTextAtSize(PACKING_SLIP_FOOTER, 9);
    page.drawText(PACKING_SLIP_FOOTER, { x: M + (CW - footW) / 2, y: footerY - 10, size: 9, font, color: BLACK });
  }

  const pdfBytes = await doc.save();
  return new Uint8Array(pdfBytes);
}
