const twilio = require("twilio");

/**
 * Send a WhatsApp message via Twilio.
 * @param {string} text - message content
 */
async function sendWhatsAppMessage(text) {
  const client = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  );

  // Twilio WhatsApp has a 1600-char limit per message
  const chunks = splitText(text, 1600);

  for (const chunk of chunks) {
    await client.messages.create({
      from: process.env.TWILIO_WHATSAPP_NUMBER,
      to: process.env.USER_WHATSAPP_NUMBER,
      body: chunk,
    });
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
    let splitAt = remaining.lastIndexOf("\n", maxLength);
    if (splitAt === -1 || splitAt < maxLength / 2) {
      splitAt = maxLength;
    }
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt);
  }
  return chunks;
}

module.exports = { sendWhatsAppMessage };
