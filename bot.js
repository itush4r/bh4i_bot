/**
 * Telegram Bot — listens for commands and responds with summaries.
 * Uses raw fetch instead of node-telegram-bot-api (works on corporate networks).
 *
 * Commands:
 *   /news    — Fetch latest news summary
 *   /start   — Welcome message
 *   /help    — Show available commands
 *
 * Usage: node bot.js
 */

require("dotenv").config({ path: ".env.local" });

const { getTopNews } = require("./src/lib/news");
const { generateSummary, generateChatResponse } = require("./src/lib/ai");
const { logSummary } = require("./src/lib/logger");

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const API = `https://api.telegram.org/bot${TOKEN}`;

// In-memory session store for chat history
const userSessions = {};

let lastUpdateId = 0;

async function sendMessage(chatId, text, parseMode = "Markdown") {
  // Split long messages (Telegram 4096 char limit)
  const chunks = splitText(text, 4096);
  for (const chunk of chunks) {
    await fetch(`${API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: chunk,
        parse_mode: parseMode,
      }),
    });
  }
}

async function handleCommand(msg) {
  const chatId = msg.chat.id;
  const text = (msg.text || "").trim();

  if (text === "/start") {
    await sendMessage(
      chatId,
      "👋 Hey! I'm your personal AI assistant.\n\nUse /news to get your daily briefing.\nUse /help to see all commands."
    );
    return;
  }

  if (text === "/help") {
    await sendMessage(
      chatId,
      "📌 *Available Commands:*\n\n/news — Get latest tech & general news summary\n/help — Show this message\n/start — Welcome message"
    );
    return;
  }

  if (text === "/news") {
    await sendMessage(chatId, "⏳ Fetching news and generating summary...", "");

    try {
      const news = await getTopNews();

      if (news.length === 0) {
        await sendMessage(chatId, "😕 No news found right now. Try again later.", "");
        return;
      }

      const summary = await generateSummary({ emails: [], news });

      const header = `🤖 *Daily Briefing — ${new Date().toLocaleDateString("en-IN", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      })}*\n\n`;

      await sendMessage(chatId, header + summary);
      logSummary({ summary, status: "success" });
    } catch (error) {
      console.error("Error:", error.message);
      await sendMessage(chatId, `❌ Error: ${error.message}`, "");
      logSummary({ summary: null, status: "error", error: error.message });
    }
    return;
  }

  if (text === "/reset") {
    userSessions[chatId] = [];
    await sendMessage(chatId, "🧹 History cleared! How can I help you now?");
    return;
  }

  // General Chat Fallback
  console.log(`[Chat] Handling message from ${chatId}: "${text}"`);
  
  if (!userSessions[chatId]) {
    userSessions[chatId] = [];
  }
  
  const history = userSessions[chatId];
  
  // Add user message to history
  history.push({ role: "user", content: text });

  try {
    const response = await generateChatResponse(history);
    
    // Add assistant response to history
    history.push({ role: "assistant", content: response });
    
    // Send response to Telegram
    await sendMessage(chatId, response);
  } catch (error) {
    console.error("[Chat Error]:", error.message);
    await sendMessage(chatId, "❌ Sorry, I had some trouble generating a response. Try again later.");
  }
}

async function pollUpdates() {
  try {
    const res = await fetch(
      `${API}/getUpdates?offset=${lastUpdateId + 1}&timeout=30`
    );
    const data = await res.json();

    if (data.ok && data.result.length > 0) {
      for (const update of data.result) {
        lastUpdateId = update.update_id;
        if (update.message) {
          handleCommand(update.message);
        }
      }
    }
  } catch (err) {
    console.error("Polling error:", err.message);
    // Wait a bit before retrying on error
    await new Promise((r) => setTimeout(r, 3000));
  }
}

async function startBot() {
  console.log("🤖 Chotu bot is running... Waiting for commands.");

  // Continuous polling loop
  while (true) {
    await pollUpdates();
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

startBot();
