const TELEGRAM_API = "https://api.telegram.org";

/**
 * Send a message to Telegram via Bot API.
 * Automatically splits messages over 4096 chars.
 * @param {string} text - message content
 * @param {string|number} [targetChatId] - optional target chat ID
 */
async function sendTelegramMessage(text, targetChatId) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = targetChatId || process.env.ADMIN_CHAT_ID;
  const url = `${TELEGRAM_API}/bot${token}/sendMessage`;

  // Telegram has a 4096-char limit per message
  const chunks = splitText(text, 4096);

  for (const chunk of chunks) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: chunk,
        parse_mode: "Markdown",
      }),
    });

    const data = await res.json();
    if (!data.ok) {
      // If Markdown parsing failed, retry without formatting
      if (data.description && data.description.includes("can't parse entities")) {
        const retry = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text: chunk }),
        });
        const retryData = await retry.json();
        if (!retryData.ok) {
          throw new Error(`Telegram API error: ${retryData.description}`);
        }
      } else {
        throw new Error(`Telegram API error: ${data.description}`);
      }
    }
  }
}

function splitText(text, maxLength) {
  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }
    // Try to split at a newline near the limit
    let splitAt = remaining.lastIndexOf("\n", maxLength);
    if (splitAt === -1 || splitAt < maxLength / 2) {
      splitAt = maxLength;
    }
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt);
  }
  return chunks;
}

/**
 * Send a file (document) to a Telegram chat.
 * @param {Buffer} buffer   — file content
 * @param {string} fileName — file name (determines extension shown in Telegram)
 * @param {string|number} chatId
 */
async function sendTelegramFile(buffer, fileName, chatId) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const url   = `${TELEGRAM_API}/bot${token}/sendDocument`;

  const formData = new FormData();
  formData.append("chat_id", String(chatId));
  formData.append("document", new Blob([buffer]), fileName);

  const res  = await fetch(url, { method: "POST", body: formData });
  const data = await res.json();

  if (!data.ok) {
    throw new Error(`Telegram sendDocument error: ${data.description}`);
  }
}

module.exports = { sendTelegramMessage, sendTelegramFile };
