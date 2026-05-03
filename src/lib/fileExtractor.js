/**
 * Extract readable text from a file buffer based on its type.
 * Images return a special "[IMAGE_FILE:<base64>]" token for Vision handling.
 * Returns null for unsupported types.
 *
 * Heavy libraries (mammoth, pdf-parse, exceljs) are dynamically imported
 * so they don't crash the webhook route at module-load time.
 */
export async function extractTextFromFile(buffer, fileType) {
  switch (fileType) {
    case "pdf": {
      try {
        const { extractText } = await import("unpdf");
        const { text } = await extractText(new Uint8Array(buffer), { mergePages: true });
        return text?.trim() || null;
      } catch (err) {
        console.error("[fileExtractor] PDF extraction failed:", err?.message || err);
        return null;
      }
    }

    case "docx": {
      const mammoth = (await import("mammoth")).default;
      const result = await mammoth.extractRawText({ buffer });
      return result.value?.trim() || null;
    }

    case "txt": {
      return buffer.toString("utf-8").trim() || null;
    }

    case "csv": {
      // CSV: just read as plain text — it's already comma-separated
      return buffer.toString("utf-8").trim() || null;
    }

    case "xlsx": {
      const ExcelJS = (await import("exceljs")).default;
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);
      let text = "";
      workbook.eachSheet((sheet) => {
        text += `Sheet: ${sheet.name}\n`;
        sheet.eachRow((row) => {
          text += row.values.slice(1).join(",") + "\n";
        });
        text += "\n";
      });
      return text.trim() || null;
    }

    case "image": {
      // Images go directly to Gemini Vision — return base64 token
      return `[IMAGE_FILE:${buffer.toString("base64")}]`;
    }

    default:
      return null;
  }
}

/**
 * Map a file extension to a normalised file type string.
 */
export function getFileType(fileName) {
  const ext = (fileName || "").split(".").pop().toLowerCase();
  const map = {
    pdf:  "pdf",
    docx: "docx", doc: "docx",
    txt:  "txt",  md:  "txt",
    csv:  "csv",
    xlsx: "xlsx", xls: "xlsx",
    jpg:  "image", jpeg: "image", png: "image", webp: "image",
  };
  return map[ext] || "unknown";
}
