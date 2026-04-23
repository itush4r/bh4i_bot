import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { Document, Paragraph, TextRun, Packer } from "docx";

const LINE_HEIGHT = 16;
const FONT_SIZE   = 11;
const MARGIN      = 50;
const MAX_CHARS   = 90; // chars per line before wrapping

// ─── PDF ──────────────────────────────────────────────────────────────────────

/**
 * Append rewritten content as a new page on an existing PDF.
 * Falls back to a fresh PDF if the original can't be loaded.
 */
export async function generatePDF(originalBuffer, rewrittenContent, fileName) {
  try {
    const pdfDoc = await PDFDocument.load(originalBuffer, { ignoreEncryption: true });
    await appendContentPage(pdfDoc, rewrittenContent, "Updated Content");
    return Buffer.from(await pdfDoc.save());
  } catch {
    return generateFreshPDF(rewrittenContent, fileName);
  }
}

export async function generateFreshPDF(content, fileName) {
  const pdfDoc = await PDFDocument.create();
  const font   = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const addPage = () => {
    const page = pdfDoc.addPage();
    return { page, y: page.getSize().height - MARGIN, width: page.getSize().width };
  };

  let { page, y, width } = addPage();

  // Title
  page.drawText(fileName, { x: MARGIN, y, size: 14, font: boldFont, color: rgb(0, 0, 0) });
  y -= 30;

  for (const line of content.split("\n")) {
    if (y < MARGIN) {
      ({ page, y, width } = addPage());
    }
    page.drawText(line.slice(0, MAX_CHARS), { x: MARGIN, y, size: FONT_SIZE, font, color: rgb(0.1, 0.1, 0.1) });
    y -= LINE_HEIGHT;
  }

  return Buffer.from(await pdfDoc.save());
}

async function appendContentPage(pdfDoc, content, title) {
  const font     = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const page     = pdfDoc.addPage();
  const { height } = page.getSize();
  let y = height - MARGIN;

  page.drawText(title, { x: MARGIN, y, size: 14, font: boldFont, color: rgb(0, 0, 0) });
  y -= 28;

  for (const line of content.split("\n")) {
    if (y < MARGIN) break;
    page.drawText(line.slice(0, MAX_CHARS), { x: MARGIN, y, size: FONT_SIZE, font, color: rgb(0.1, 0.1, 0.1) });
    y -= LINE_HEIGHT;
  }
}

// ─── DOCX ─────────────────────────────────────────────────────────────────────

export async function generateDOCX(rewrittenContent, fileName) {
  const paragraphs = rewrittenContent.split("\n").map(
    (line) => new Paragraph({
      children: [new TextRun({ text: line, size: 22 })],
      spacing:  { after: 120 },
    })
  );

  const doc = new Document({
    sections: [{
      properties: {},
      children: [
        new Paragraph({
          children: [new TextRun({ text: fileName, bold: true, size: 28 })],
          spacing:  { after: 400 },
        }),
        ...paragraphs,
      ],
    }],
  });

  return Packer.toBuffer(doc);
}

// ─── Plain text / CSV ─────────────────────────────────────────────────────────

function generateTextBuffer(content) {
  return Buffer.from(content, "utf-8");
}

// ─── Universal router ─────────────────────────────────────────────────────────

/**
 * Generate an updated file in the original format.
 * @param {Buffer}  originalBuffer    — original file bytes (used for PDF modification)
 * @param {string}  rewrittenContent  — AI-generated updated text
 * @param {string}  fileName
 * @param {string}  fileType          — pdf | docx | txt | csv
 * @returns {Promise<Buffer>}
 */
export async function generateUpdatedFile(originalBuffer, rewrittenContent, fileName, fileType) {
  switch (fileType) {
    case "pdf":  return generatePDF(originalBuffer, rewrittenContent, fileName);
    case "docx": return generateDOCX(rewrittenContent, fileName);
    default:     return generateTextBuffer(rewrittenContent);
  }
}
