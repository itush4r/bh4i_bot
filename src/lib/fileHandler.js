import { sendTelegramMessage } from "./telegram.js";
import { extractTextFromFile, getFileType } from "./fileExtractor.js";
import { storeFileGridFS } from "./gridfs.js";
import { analyseFile } from "./ai.js";
import { checkQuota, deductQuota } from "./quota.js";
import User from "../models/User.js";

const TELEGRAM_API = "https://api.telegram.org";

/**
 * Handle an incoming file message from Telegram.
 * Downloads, extracts text, analyses with AI, stores in GridFS + MongoDB.
 */
export async function handleFileUpload(fileObj, message, user, chatId) {
  // Quota check (costs 3 tokens)
  const quota = await checkQuota(user, "file");
  if (!quota.allowed) {
    await sendTelegramMessage(quota.message, chatId);
    return;
  }

  await sendTelegramMessage("📎 Got your file! Reading it...", chatId);

  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;

    // 1. Get file path from Telegram
    const fileInfoRes = await fetch(`${TELEGRAM_API}/bot${token}/getFile?file_id=${fileObj.file_id}`);
    const fileInfo    = await fileInfoRes.json();

    if (!fileInfo.ok || !fileInfo.result?.file_path) {
      await sendTelegramMessage("❌ Couldn't retrieve this file from Telegram. Try again.", chatId);
      return;
    }

    const fileUrl = `${TELEGRAM_API}/file/bot${token}/${fileInfo.result.file_path}`;

    // 2. Download as buffer
    const fileBuffer = Buffer.from(await fetch(fileUrl).then((r) => r.arrayBuffer()));

    const fileName = message.document?.file_name || `file_${Date.now()}`;
    const fileType = getFileType(fileName);
    const fileSizeKB = Math.round(fileBuffer.length / 1024);

    // 3. Reject unsupported types
    if (fileType === "unknown") {
      await sendTelegramMessage(
        "❌ Unsupported file type.\n\nSupported: PDF, DOCX, TXT, MD, CSV, XLSX, JPG, PNG, WEBP",
        chatId
      );
      return;
    }

    // 4. Extract text
    const extractedText = await extractTextFromFile(fileBuffer, fileType);

    if (!extractedText || extractedText.length < 10) {
      await sendTelegramMessage(
        "❌ Couldn't read this file. It may be a scanned image, password-protected PDF, or empty.\n\n" +
        "Try sending a text-based PDF or DOCX instead.",
        chatId
      );
      return;
    }

    // 5. Store original binary in GridFS
    const gridfsId = await storeFileGridFS(fileBuffer, fileName, chatId);

    // 6. AI analysis
    const analysis = await analyseFile(extractedText, fileName, fileType, user);

    // 7. Save to user.files[] (keep last 10)
    await User.updateOne(
      { chatId: String(chatId) },
      {
        $push: {
          files: {
            $each: [{
              name:          fileName,
              type:          fileType,
              summary:       analysis.summary,
              extractedText: extractedText.slice(0, 50000),
              gridfsId,
              uploadedAt:    new Date(),
              sizeKB:        fileSizeKB,
              isActive:      true,
            }],
            $slice: -10,
          },
        },
      }
    );

    // 8. Deduct quota and send feedback
    await deductQuota(user, "file");

    await sendTelegramMessage(
      `📎 *${fileName}* saved! (${fileSizeKB} KB)\n\n` +
      `${analysis.feedback}\n\n` +
      `_Ask me anything about this file, or say "rewrite [section]" to improve it._` +
      (quota.warning || ""),
      chatId
    );

  } catch (err) {
    console.error("[File Upload Error]:", err.message);
    await sendTelegramMessage(
      "❌ Something went wrong reading your file. Please try again.",
      chatId
    );
  }
}
