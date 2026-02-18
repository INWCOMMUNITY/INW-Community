/** Shared branding for packing slips (website print + mobile app PDF). */
export const PACKING_SLIP_FOOTER = "- inwcommunity.com";

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const PT_PER_IN = 72;
const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 0.25 * PT_PER_IN; // 0.25in
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const BLACK = rgb(0, 0, 0);

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
  packingSlipNote?: string | null;
}

function formatSellerAddress(addr: string | null, city?: string | null): string {
  if (!addr?.trim()) return "";
  const lines: string[] = addr.split(/\n/).map((l) => l.trim()).filter(Boolean);
  if (city?.trim()) lines.push(city.trim());
  return lines.join("\n");
}

function formatShipToAddress(addr: unknown): string {
  if (!addr || typeof addr !== "object") return "";
  const a = addr as Record<string, string>;
  const parts: string[] = [];
  if (a.name) parts.push(a.name);
  if (a.street ?? a.address) parts.push((a.street ?? a.address) as string);
  if (a.street2) parts.push(a.street2);
  const cityStateZip = [a.city, a.state, a.zip].filter(Boolean).join(", ");
  if (cityStateZip) parts.push(cityStateZip);
  if (a.country && a.country !== "US") parts.push(a.country);
  return parts.join("\n");
}

type PDFPage = Awaited<ReturnType<PDFDocument["addPage"]>>;

async function tryEmbedLogo(doc: PDFDocument, logoUrl: string): Promise<{ draw: (p: PDFPage, x: number, y: number, size: number) => void } | null> {
  try {
    const res = await fetch(logoUrl);
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    const ct = res.headers.get("content-type") ?? "";
    const img = ct.includes("png") ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
    const { width, height } = img.scale(1);
    return {
      draw: (p: PDFPage, x: number, y: number, size: number) => {
        const scale = size / Math.max(width, height);
        p.drawImage(img, { x, y, width: width * scale, height: height * scale });
      },
    };
  } catch {
    return null;
  }
}

export async function generatePackingSlipPdf(
  groups: PackingSlipGroup[],
  sellerProfile: PackingSlipSellerProfile
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  const biz = sellerProfile.business;
  const bizName = biz?.name ?? "Business";
  const returnAddress = biz
    ? [biz.name, biz.phone, formatSellerAddress(biz.address, biz.city)].filter(Boolean).join("\n")
    : "";

  function drawText(text: string, opts?: { bold?: boolean; size?: number }): void {
    const f = opts?.bold ? fontBold : font;
    const size = opts?.size ?? 10;
    const lines = text.split(/\n/);
    for (const line of lines) {
      const wrapped = line.length > 55 ? line.match(/.{1,55}(\s|$)/g) ?? [line] : [line];
      for (const seg of wrapped) {
        if (y - size < MARGIN) {
          page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
          y = PAGE_HEIGHT - MARGIN;
        }
        page.drawText(seg.trim(), { x: MARGIN, y, size, font: f, color: BLACK });
        y -= size * 1.2;
      }
    }
  }

  for (const group of groups) {
    if (y < PAGE_HEIGHT * 0.5) {
      page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = PAGE_HEIGHT - MARGIN;
    }

    const logoSize = 72;
    if (biz?.logoUrl) {
      const logo = await tryEmbedLogo(doc, biz.logoUrl);
      if (logo) logo.draw(page, MARGIN, y - logoSize, logoSize);
      else page.drawText("Business Logo", { x: MARGIN, y: y - 36, size: 9, font, color: BLACK });
    }
    y -= logoSize + 12;

    const noteText = sellerProfile.packingSlipNote?.trim() || "—";
    drawText(`A Note from ${bizName}`, { bold: true, size: 10 });
    drawText(noteText.slice(0, 250), { size: 9 });
    y -= 12;

    const shipAddr = formatShipToAddress(group.orders[0]?.shippingAddress);
    drawText("RETURN ADDRESS", { bold: true, size: 9 });
    drawText(returnAddress || "—", { size: 10 });
    y -= 8;
    drawText("SHIPPING ADDRESS", { bold: true, size: 9 });
    drawText(`${group.buyer.firstName} ${group.buyer.lastName}\n${shipAddr || "—"}`, { size: 10 });
    y -= 16;

    page.drawText("Qty", { x: MARGIN, y, size: 9, font: fontBold, color: BLACK });
    page.drawText("Item", { x: MARGIN + 60, y, size: 9, font: fontBold, color: BLACK });
    page.drawText("Price", { x: CONTENT_WIDTH - 50, y, size: 9, font: fontBold, color: BLACK });
    y -= 14;

    for (const oi of group.combinedItems) {
      if (y < MARGIN + 40) {
        page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
        y = PAGE_HEIGHT - MARGIN;
      }
      page.drawText(String(oi.quantity), { x: MARGIN, y, size: 9, font, color: BLACK });
      page.drawText(oi.storeItem.title.slice(0, 40), { x: MARGIN + 60, y, size: 9, font, color: BLACK });
      page.drawText(`$${(oi.priceCentsAtPurchase / 100).toFixed(2)}`, { x: CONTENT_WIDTH - 50, y, size: 9, font, color: BLACK });
      y -= 14;
    }
    y -= 8;
    page.drawText(`Shipping: $${(group.shippingCostCents / 100).toFixed(2)}`, { x: MARGIN, y, size: 9, font, color: BLACK });
    y -= 12;
    if (group.taxCents && group.taxCents > 0) {
      page.drawText(`Tax: $${(group.taxCents / 100).toFixed(2)}`, { x: MARGIN, y, size: 9, font, color: BLACK });
      y -= 12;
    }
    page.drawText(`Total: $${(group.totalCents / 100).toFixed(2)}`, { x: MARGIN, y, size: 10, font: fontBold, color: BLACK });
    y -= 24;

    page.drawText("Thank you for Supporting Locally Owned Businesses!", {
      x: MARGIN,
      y,
      size: 12,
      font: fontBold,
      color: BLACK,
    });
    y -= 14;
    page.drawText(PACKING_SLIP_FOOTER, { x: MARGIN, y, size: 9, font, color: BLACK });
    y -= MARGIN;
  }

  const pdfBytes = await doc.save();
  return new Uint8Array(pdfBytes);
}
