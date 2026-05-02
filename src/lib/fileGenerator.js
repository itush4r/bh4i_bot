import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import {
  Document,
  Paragraph,
  TextRun,
  Packer,
  HeadingLevel,
  AlignmentType,
} from "docx";
import { generateLatexPDF, shouldUseLatex } from "./latexGenerator.js";

const FONT_SIZE       = 11;
const HEADING_SIZES   = { 1: 16, 2: 14, 3: 12 };
const LINE_HEIGHT     = 16;
const HEADING_SPACING = 8;
const MARGIN          = 50;

// ─── PDF helpers ──────────────────────────────────────────────────────────────

function detectHeading(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const md = /^(#{1,6})\s+(.+)$/.exec(trimmed);
  if (md) return { level: Math.min(md[1].length, 3), text: md[2].trim() };

  if (
    trimmed.length >= 3 &&
    trimmed.length <= 70 &&
    trimmed === trimmed.toUpperCase() &&
    /[A-Z]/.test(trimmed) &&
    /^[A-Z0-9 \-:&,/()]+$/.test(trimmed) &&
    !/[.!?]$/.test(trimmed)
  ) {
    return { level: 1, text: trimmed };
  }

  return null;
}

function wrapLine(text, font, size, maxWidth) {
  if (!text) return [""];
  const words = text.split(/\s+/);
  const lines = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      // Word longer than maxWidth — hard-split it
      if (font.widthOfTextAtSize(word, size) > maxWidth) {
        let chunk = "";
        for (const ch of word) {
          if (font.widthOfTextAtSize(chunk + ch, size) > maxWidth) {
            if (chunk) lines.push(chunk);
            chunk = ch;
          } else {
            chunk += ch;
          }
        }
        current = chunk;
      } else {
        current = word;
      }
    }
  }
  if (current) lines.push(current);
  return lines;
}

async function renderContentPages(pdfDoc, content, title) {
  const font     = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const newPage = () => {
    const page = pdfDoc.addPage();
    const { width, height } = page.getSize();
    return { page, y: height - MARGIN, width, maxWidth: width - 2 * MARGIN };
  };

  let ctx = newPage();

  const ensureSpace = (needed) => {
    if (ctx.y - needed < MARGIN) ctx = newPage();
  };

  if (title) {
    ensureSpace(28);
    ctx.page.drawText(title, {
      x: MARGIN, y: ctx.y, size: 16, font: boldFont, color: rgb(0, 0, 0),
    });
    ctx.y -= 28;
  }

  for (const rawLine of content.split("\n")) {
    const heading = detectHeading(rawLine);
    if (heading) {
      const size = HEADING_SIZES[heading.level] || HEADING_SIZES[3];
      const wrapped = wrapLine(heading.text, boldFont, size, ctx.maxWidth);
      ensureSpace(HEADING_SPACING);
      ctx.y -= HEADING_SPACING;
      for (const w of wrapped) {
        ensureSpace(size + 4);
        ctx.page.drawText(w, {
          x: MARGIN, y: ctx.y, size, font: boldFont, color: rgb(0, 0, 0),
        });
        ctx.y -= size + 4;
      }
      ctx.y -= 4;
      continue;
    }

    if (!rawLine.trim()) {
      ctx.y -= LINE_HEIGHT / 2;
      continue;
    }

    const wrapped = wrapLine(rawLine, font, FONT_SIZE, ctx.maxWidth);
    for (const w of wrapped) {
      ensureSpace(LINE_HEIGHT);
      ctx.page.drawText(w, {
        x: MARGIN, y: ctx.y, size: FONT_SIZE, font, color: rgb(0.1, 0.1, 0.1),
      });
      ctx.y -= LINE_HEIGHT;
    }
  }
}

// ─── PDF generators ───────────────────────────────────────────────────────────

/**
 * Append rewritten content as new pages on the original PDF.
 * Falls back to a fresh PDF if the original can't be loaded.
 */
export async function generatePDF(originalBuffer, rewrittenContent, fileName) {
  try {
    const pdfDoc = await PDFDocument.load(originalBuffer, { ignoreEncryption: true });
    await renderContentPages(pdfDoc, rewrittenContent, "Updated Content");
    return Buffer.from(await pdfDoc.save());
  } catch {
    return generateFreshPDF(rewrittenContent, fileName);
  }
}

export async function generateFreshPDF(content, fileName) {
  const pdfDoc = await PDFDocument.create();
  await renderContentPages(pdfDoc, content, fileName);
  return Buffer.from(await pdfDoc.save());
}

// ─── DOCX ─────────────────────────────────────────────────────────────────────

const HEADING_LEVEL_MAP = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
};

export async function generateDOCX(rewrittenContent, fileName) {
  const children = [
    new Paragraph({
      children: [new TextRun({ text: fileName, bold: true, size: 32 })],
      alignment: AlignmentType.CENTER,
      spacing:  { after: 400 },
    }),
  ];

  for (const rawLine of rewrittenContent.split("\n")) {
    const heading = detectHeading(rawLine);
    if (heading) {
      children.push(new Paragraph({
        text: heading.text,
        heading: HEADING_LEVEL_MAP[heading.level] || HeadingLevel.HEADING_3,
        spacing: { before: 200, after: 120 },
      }));
      continue;
    }

    if (!rawLine.trim()) {
      children.push(new Paragraph({ children: [new TextRun({ text: "" })] }));
      continue;
    }

    children.push(new Paragraph({
      children: [new TextRun({ text: rawLine, size: 22 })],
      spacing:  { after: 120 },
    }));
  }

  const doc = new Document({ sections: [{ properties: {}, children }] });
  return Packer.toBuffer(doc);
}

// ─── Plain text / CSV ─────────────────────────────────────────────────────────

function generateTextBuffer(content) {
  return Buffer.from(content, "utf-8");
}

// ─── Universal router ─────────────────────────────────────────────────────────

/**
 * Generate an updated file in the original format.
 * Returns { buffer, format } where format ∈ "latex" | "pdf" | "docx" | "text".
 *
 * @param {Buffer}  originalBuffer    original file bytes (used for PDF append-mode)
 * @param {string}  rewrittenContent  AI-generated updated text
 * @param {string}  fileName
 * @param {string}  fileType          pdf | docx | txt | csv | md
 * @returns {Promise<{buffer: Buffer, format: string}>}
 */
export async function generateUpdatedFile(originalBuffer, rewrittenContent, fileName, fileType) {
  if (fileType === "pdf") {
    if (shouldUseLatex(rewrittenContent)) {
      const latexBuf = await generateLatexPDF(rewrittenContent, fileName);
      if (latexBuf) return { buffer: latexBuf, format: "latex" };
    }
    const buffer = await generatePDF(originalBuffer, rewrittenContent, fileName);
    return { buffer, format: "pdf" };
  }

  if (fileType === "docx") {
    const buffer = await generateDOCX(rewrittenContent, fileName);
    return { buffer, format: "docx" };
  }

  return { buffer: generateTextBuffer(rewrittenContent), format: "text" };
}
