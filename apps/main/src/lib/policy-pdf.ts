import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const PT_PER_IN = 72;
const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 0.75 * PT_PER_IN;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const LINE_HEIGHT = 1.35;
const BLACK = rgb(0.15, 0.15, 0.15);

function wrapText(
  text: string,
  maxWidth: number,
  font: { widthOfTextAtSize: (t: string, size: number) => number },
  fontSize: number
): string[] {
  const words = text.split(/\s+/);
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

/** Replace Unicode chars with ASCII-safe equivalents for StandardFont encoding */
function sanitizeForPdf(text: string): string {
  return text
    .replace(/\u25CF/g, "-")  // ● BLACK CIRCLE
    .replace(/\u2022/g, "-")  // • BULLET
    .replace(/\u25CB/g, "-")  // ○ WHITE CIRCLE
    .replace(/\u25E6/g, "-")  // ◦ WHITE BULLET
    .replace(/\u2192/g, "->") // → RIGHT ARROW
    .replace(/\u2013/g, "-")  // – EN DASH
    .replace(/\u2014/g, "-")  // — EM DASH
    .replace(/\u2018/g, "'")  // ' LEFT SINGLE QUOTE
    .replace(/\u2019/g, "'")  // ' RIGHT SINGLE QUOTE
    .replace(/\u201C/g, '"')  // " LEFT DOUBLE QUOTE
    .replace(/\u201D/g, '"'); // " RIGHT DOUBLE QUOTE
}

export async function generatePolicyPdf(
  title: string,
  lastUpdated: string,
  body: string
): Promise<Uint8Array> {
  const safeBody = sanitizeForPdf(body);
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fontSize = 10;
  const fontSizeTitle = 18;
  const fontSizeHeading = 12;
  const lineHeightPt = fontSize * LINE_HEIGHT;

  let page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  function addLine(
    text: string,
    opts?: { bold?: boolean; size?: number; indent?: number }
  ): void {
    const f = opts?.bold ? fontBold : font;
    const size = opts?.size ?? fontSize;
    const maxW = CONTENT_WIDTH - (opts?.indent ?? 0);
    const lines = wrapText(text, maxW, f, size);
    const lh = size * LINE_HEIGHT;
    for (const line of lines) {
      if (y - lh < MARGIN) {
        page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
        y = PAGE_HEIGHT - MARGIN;
      }
      page.drawText(line, {
        x: MARGIN + (opts?.indent ?? 0),
        y,
        size,
        font: f,
        color: BLACK,
      });
      y -= lh;
    }
  }

  addLine(title, { bold: true, size: fontSizeTitle });
  y -= 12;
  addLine(`Last Updated: ${lastUpdated}`, { size: 9 });
  y -= 24;

  const lines = safeBody.split(/\n/);
  for (const line of lines) {
    const trimmed = line.trimEnd();
    if (!trimmed) {
      y -= lineHeightPt * 0.5;
      continue;
    }
    const isSection = /^\d+\.\s[A-Z]/.test(trimmed) || /^\d+\.\s*$/.test(trimmed);
    const isSubsection = /^\d+\.\d+\s/.test(trimmed);
    const isBullet = /^-\s/.test(trimmed);
    if (isSection) {
      y -= 8;
      if (y - lineHeightPt < MARGIN) {
        page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
        y = PAGE_HEIGHT - MARGIN;
      }
      addLine(trimmed, { bold: true, size: fontSizeHeading });
      y -= 4;
    } else if (isSubsection) {
      y -= 4;
      addLine(trimmed, { bold: true });
      y -= 2;
    } else if (isBullet) {
      addLine(trimmed, { indent: 14 });
    } else {
      addLine(trimmed);
    }
    y -= 4;
  }

  const pdfBytes = await doc.save();
  return new Uint8Array(pdfBytes);
}
