import { NextResponse } from "next/server";
import { getTopNews, VALID_CATEGORIES } from "../../../../lib/news";
import { generateSummary, generateChatResponse, analyzeEmails } from "../../../../lib/ai";
import { sendTelegramMessage, sendTelegramFile } from "../../../../lib/telegram";
import { fetchEmails, sendEmail } from "../../../../lib/emailClient";
import { handleEmailSetup } from "../../../../lib/emailSetup";
import { handlePersonaSetup, startPersonaSetup } from "../../../../lib/personaSetup";
import { BUILT_IN_PERSONAS, getBuiltInPersona, isBuiltInId } from "../../../../lib/builtInPersonas";
import { getActivePersona } from "../../../../lib/persona";
import { checkQuota, deductQuota } from "../../../../lib/quota";
import { handleAdminCommand } from "../../../../lib/adminCommands";
import { checkRateLimit } from "../../../../lib/rateLimit";
import { runPhoneTask, checkBridgeHealth, syncApps } from "../../../../lib/phoneAgent";
import { handleFileUpload } from "../../../../lib/fileHandler";
import { getFileGridFS, deleteFileGridFS } from "../../../../lib/gridfs";
import { generateUpdatedFile } from "../../../../lib/fileGenerator";
import { isEscapeInput, sendEscapeMessage } from "../../../../lib/flowUtils";
import dbConnect from "../../../../lib/db";
import User from "../../../../models/User";

// In-memory cache of last fetched emails per user (chatId → email[])
// Cleared on each new /mails fetch. Used by /readmail.
const emailCache = new Map();

const ESCAPE_HINT = "\n\n_Type_ `cancel` _anytime to stop._";

// Step 0 = name (required), Step 1 = gateway (proceed / skip all / pick numbers)
// Steps 2-8 = optional preference steps
const ONBOARDING_STEPS = [
  { step: 0, field: "name",            prompt: "👋 Welcome! Let's set you up.\n\nWhat's your *name*?", required: true },
  { step: 1, field: "_gateway",        prompt: null }, // prompt built dynamically after name
  { step: 2, field: "profession",      prompt: "💼 *1. Profession* — What do you do? (e.g. Student, Software Engineer, Designer)\n\nSend *skip* to skip" + ESCAPE_HINT },
  { step: 3, field: "city",            prompt: "🏙️ *2. City* — Which city are you based in?\n\nSend *skip* to skip" + ESCAPE_HINT },
  { step: 4, field: "interests",       prompt: "🎯 *3. Interests* — What topics interest you? (e.g. Tech, Finance, Cricket, Startups)\n\nSend *skip* to skip" + ESCAPE_HINT },
  { step: 5, field: "responseStyle",   prompt: "✍️ *4. Response Style* — Pick one: *Short* / *Detailed* / *Bullets*\n\nSend *skip* to skip (default: Short)" + ESCAPE_HINT },
  { step: 6, field: "newsCategories",  prompt: "📰 *5. News Categories* — Pick from: technology, business, sports, health, science, entertainment, general\n\nSend comma-separated (e.g. `technology, sports, business`)\n\nOr send *skip* to keep defaults (technology, general)" + ESCAPE_HINT },
  { step: 7, field: "emailFocus",      prompt: "📧 *6. Email Focus* — Pick from: jobs, finance, newsletters, promotions, social, updates, all\n\nSend comma-separated (e.g. `jobs, finance, newsletters`)\n\nOr send *skip* to keep defaults (jobs, finance)" + ESCAPE_HINT },
  { step: 8, field: "briefingType",    prompt: "📬 *7. Daily Briefing* — What do you want at 9:00 AM IST every day?\n\nPick one: *both* (news + mails) / *news* / *mails* / *none* (off)\n\nSend *skip* to keep default (both)" + ESCAPE_HINT },
];

const GATEWAY_PROMPT = (name) =>
  `Nice to meet you, *${name}*! 👋\n\n` +
  `I can personalise your experience. Here's what I can set up:\n\n` +
  `1️⃣ Profession\n` +
  `2️⃣ City\n` +
  `3️⃣ Interests\n` +
  `4️⃣ Response style\n` +
  `5️⃣ News categories\n` +
  `6️⃣ Email focus areas\n` +
  `7️⃣ Daily briefing (news/mails/both/off)\n\n` +
  `What would you like to do?\n\n` +
  `• Send *proceed* — I'll walk you through each one (you can skip any)\n` +
  `• Send *skip all* — use defaults and finish setup now\n` +
  `• Send numbers like \`1, 3, 7\` — only set up those specific ones`;

// Track which steps each user chose to configure (for "pick numbers" mode)
// Map<chatId, number[]> — stores chosen ONBOARDING_STEPS indices (2-9)
const onboardingPickedSteps = new Map();

function getDefaultAccount(user) {
  if (!user.emailAccounts || user.emailAccounts.length === 0) return null;
  return user.emailAccounts.find((a) => a.isDefault) || user.emailAccounts[0];
}

function findAccountByEmail(user, email) {
  return user.emailAccounts.find(
    (a) => a.emailAddress.toLowerCase() === email.toLowerCase()
  );
}

function formatAccountList(emailAccounts) {
  return emailAccounts
    .map((a, i) => `${i + 1}. ${a.emailAddress}${a.isDefault ? " ⭐" : ""} (${a.provider})`)
    .join("\n");
}

async function getOrCreateUser(chatId) {
  let user = await User.findOne({ chatId: String(chatId) });
  if (!user) user = await User.create({ chatId: String(chatId) });
  return user;
}

/**
 * Handle input for a single onboarding preference field.
 * Returns true if input was accepted (or skipped), false if validation failed (user should retry).
 */
async function handleOnboardingField(field, text, skip, user, chatId) {
  if (field === "newsCategories") {
    if (!skip) {
      const cats = text.split(",").map((c) => c.trim().toLowerCase()).filter(Boolean);
      const valid = ["technology", "business", "sports", "health", "science", "entertainment", "general"];
      const invalid = cats.filter((c) => !valid.includes(c));
      if (invalid.length > 0) {
        await sendTelegramMessage(
          `❌ Invalid: ${invalid.join(", ")}\n\nValid: ${valid.join(", ")}\n\nTry again or send *skip*`,
          chatId
        );
        return false;
      }
      user.newsCategories = cats;
    }
  } else if (field === "emailFocus") {
    if (!skip) {
      const focus = text.split(",").map((f) => f.trim().toLowerCase()).filter(Boolean);
      const valid = ["jobs", "finance", "newsletters", "promotions", "social", "updates", "all"];
      const invalid = focus.filter((f) => !valid.includes(f));
      if (invalid.length > 0) {
        await sendTelegramMessage(
          `❌ Invalid: ${invalid.join(", ")}\n\nValid: ${valid.join(", ")}\n\nTry again or send *skip*`,
          chatId
        );
        return false;
      }
      user.emailFocus = focus;
    }
  } else if (field === "briefingType") {
    if (!skip) {
      const val = text.toLowerCase().trim();
      const valid = ["both", "news", "mails", "none"];
      if (!valid.includes(val)) {
        await sendTelegramMessage(
          `❌ Invalid: ${val}\n\nValid: both, news, mails, none\n\nTry again or send *skip*`,
          chatId
        );
        return false;
      }
      if (!user.briefing) user.briefing = {};
      user.briefing.type = val;
    }
  } else {
    // String fields: profession, city, interests, responseStyle
    if (!skip) {
      user[field] = text;
    }
  }
  return true;
}

/**
 * Send the onboarding completion message.
 */
async function sendOnboardingComplete(user, chatId) {
  const cats  = (user.newsCategories || ["technology", "general"]).join(", ");
  const focus = (user.emailFocus || ["jobs", "finance"]).join(", ");
  const bType = user.briefing?.type || "both";
  const briefingLabel = { both: "News + Mails", news: "News only", mails: "Mails only", none: "Off" };

  await sendTelegramMessage(
    `✅ All set, *${user.name}*! Here's your profile:\n\n` +
    `👤 Name: ${user.name}\n` +
    `💼 Profession: ${user.profession || "Not set"}\n` +
    `🏙️ City: ${user.city || "Not set"}\n` +
    `🎯 Interests: ${user.interests || "Not set"}\n` +
    `✍️ Style: ${user.responseStyle || "Short"}\n` +
    `📰 News: ${cats}\n` +
    `📧 Email focus: ${focus}\n` +
    `📬 Briefing: ${briefingLabel[bType]} at 9:00 AM IST\n\n` +
    `You can change any of these later with /setprofile, /setpref, or /setbriefing.\n\n` +
    `How can I help? 🚀`,
    chatId
  );
}

export async function POST(req) {
  let webhookChatId = null;
  try {
    const data = await req.json();

    const message = data.message;
    if (!message || !message.chat) return NextResponse.json({ ok: true });
    webhookChatId = message.chat.id;

    // Detect file messages (document or photo — no text required)
    const fileObj = message.document
      || (message.photo ? message.photo[message.photo.length - 1] : null)
      || null;

    if (fileObj && !message.text) {
      const chatId = message.chat.id;
      await dbConnect();
      const user = await getOrCreateUser(chatId);
      if (!user.onboardingComplete) {
        await sendTelegramMessage("Please complete setup first by sending /start.", chatId);
        return NextResponse.json({ ok: true });
      }
      await handleFileUpload(fileObj, message, user, chatId);
      return NextResponse.json({ ok: true });
    }

    if (!message.text) return NextResponse.json({ ok: true });

    const chatId = message.chat.id;
    const text   = message.text.trim();

    // ─── TYPING INDICATOR ─────────────────────────────────────────
    // Fire-and-forget — shows dots immediately, no await needed
    const sendTyping = () => fetch(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendChatAction`,
      {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ chat_id: chatId, action: "typing" }),
      }
    ).catch(() => {});
    sendTyping();

    // ─── TIMEOUT HELPER ───────────────────────────────────────────
    // Rejects with Error("__timeout__") after ms; callers handle it in catch
    const withTimeout = (promise, ms) =>
      Promise.race([
        promise,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("__timeout__")), ms)
        ),
      ]);

    await dbConnect();
    const user = await getOrCreateUser(chatId);

    // ─── ESCAPE / CANCEL ───────────────────────────────────────────
    // Intercept "cancel" / "stop" / "exit" mid-flow before anything else
    if (isEscapeInput(text)) {
      if (!user.onboardingComplete && user.onboardingStep > 0) {
        await User.updateOne({ chatId: String(chatId) }, { $set: { onboardingStep: 0 } });
        onboardingPickedSteps.delete(String(chatId));
        await sendEscapeMessage(chatId, "onboarding");
        return NextResponse.json({ ok: true });
      }
      if (user.pendingDelete) {
        await User.updateOne({ chatId: String(chatId) }, { $set: { pendingDelete: false } });
        await sendEscapeMessage(chatId, "deleteAccount");
        return NextResponse.json({ ok: true });
      }
      if (user.emailSetupPending) {
        await User.updateOne({ chatId: String(chatId) }, {
          $set: {
            emailSetupPending: false,
            emailSetupStep:    0,
            emailProviderTemp: null,
            emailAddressTemp:  null,
            imapHostTemp:      null,
          },
        });
        await sendEscapeMessage(chatId, "emailSetup");
        return NextResponse.json({ ok: true });
      }
      if (user.personaSetupPending) {
        await User.updateOne({ chatId: String(chatId) }, {
          $set: {
            personaSetupPending: false,
            personaSetupStep:    0,
            personaSetupDraft:   null,
          },
        });
        await sendEscapeMessage(chatId, "personaSetup");
        return NextResponse.json({ ok: true });
      }
      // Not in any active flow — fall through to chat / commands
    }

    // ─── RATE LIMIT (per-user, MongoDB) ───────────────────────────
    const rateCheck = await checkRateLimit(user);
    if (!rateCheck.allowed) {
      await sendTelegramMessage(rateCheck.message, chatId);
      return NextResponse.json({ ok: true });
    }

    // ─── ADMIN COMMANDS ────────────────────────────────────────────
    const adminHandled = await handleAdminCommand(text, chatId);
    if (adminHandled) return NextResponse.json({ ok: true });

    // ─── COMMAND: /start ───────────────────────────────────────────
    if (text === "/start") {
      user.onboardingComplete = false;
      user.onboardingStep = 0;
      user.history = [];
      await user.save();
      onboardingPickedSteps.delete(String(chatId));
      await sendTelegramMessage(ONBOARDING_STEPS[0].prompt, chatId);
      return NextResponse.json({ ok: true });
    }

    // ─── ONBOARDING IN PROGRESS ────────────────────────────────────
    if (!user.onboardingComplete) {
      const currentStep = user.onboardingStep;
      const stepDef     = ONBOARDING_STEPS[currentStep];

      if (stepDef) {
        const skip = text.toLowerCase() === "skip";
        const cid  = String(chatId);

        // ── Step 0: Name (required) ──
        if (stepDef.field === "name") {
          if (skip) {
            await sendTelegramMessage("❌ Name is required and cannot be skipped. Please enter your name.", chatId);
            return NextResponse.json({ ok: true });
          }
          user.name = text;
          user.onboardingStep = 1;
          await user.save();
          await sendTelegramMessage(GATEWAY_PROMPT(text), chatId);
          return NextResponse.json({ ok: true });
        }

        // ── Step 1: Gateway choice ──
        if (stepDef.field === "_gateway") {
          const lower = text.toLowerCase().trim();

          // "skip all" → finish with defaults
          if (lower === "skip all" || lower === "skipall") {
            user.onboardingComplete = true;
            user.onboardingStep = ONBOARDING_STEPS.length;
            await user.save();
            onboardingPickedSteps.delete(cid);
            await sendOnboardingComplete(user, chatId);
            return NextResponse.json({ ok: true });
          }

          // "proceed" → go through steps 2-9 one by one
          if (lower === "proceed") {
            onboardingPickedSteps.delete(cid);
            user.onboardingStep = 2;
            await user.save();
            await sendTelegramMessage(ONBOARDING_STEPS[2].prompt, chatId);
            return NextResponse.json({ ok: true });
          }

          // Numbers like "1, 3, 7" → pick specific steps
          const nums = text.split(/[\s,]+/).map((n) => parseInt(n, 10)).filter((n) => n >= 1 && n <= 7);
          if (nums.length > 0) {
            // Map user numbers 1-8 → ONBOARDING_STEPS indices 2-9
            const stepIndices = [...new Set(nums)].sort((a, b) => a - b).map((n) => n + 1);
            onboardingPickedSteps.set(cid, stepIndices);
            const firstIdx = stepIndices[0];
            user.onboardingStep = firstIdx;
            await user.save();
            await sendTelegramMessage(ONBOARDING_STEPS[firstIdx].prompt, chatId);
            return NextResponse.json({ ok: true });
          }

          // Invalid input
          await sendTelegramMessage(
            "❌ Please send:\n• *proceed* — set up one by one\n• *skip all* — use defaults\n• Numbers like `1, 3, 7` — pick specific ones",
            chatId
          );
          return NextResponse.json({ ok: true });
        }

        // ── Steps 2-9: Preference steps ──

        // Process the current step's input
        const fieldHandled = await handleOnboardingField(stepDef.field, text, skip, user, chatId);
        if (!fieldHandled) return NextResponse.json({ ok: true }); // validation failed, retry

        // Determine next step
        const picked = onboardingPickedSteps.get(cid);

        if (picked) {
          // "Pick numbers" mode — find next picked step after current
          const nextIdx = picked.find((idx) => idx > currentStep);
          if (nextIdx) {
            user.onboardingStep = nextIdx;
            await user.save();
            await sendTelegramMessage(ONBOARDING_STEPS[nextIdx].prompt, chatId);
          } else {
            // All picked steps done
            user.onboardingComplete = true;
            user.onboardingStep = ONBOARDING_STEPS.length;
            await user.save();
            onboardingPickedSteps.delete(cid);
            await sendOnboardingComplete(user, chatId);
          }
        } else {
          // "Proceed" mode — go to next sequential step
          if (currentStep >= ONBOARDING_STEPS.length - 1) {
            user.onboardingComplete = true;
            user.onboardingStep = ONBOARDING_STEPS.length;
            await user.save();
            await sendOnboardingComplete(user, chatId);
          } else {
            user.onboardingStep = currentStep + 1;
            await user.save();
            await sendTelegramMessage(ONBOARDING_STEPS[currentStep + 1].prompt, chatId);
          }
        }

        return NextResponse.json({ ok: true });
      }
    }

    // ─── From here on, user is onboarded ───────────────────────────

    // ─── COMMAND: /help ────────────────────────────────────────────
    if (text === "/help") {
      await sendTelegramMessage(
        "📌 *Commands & Examples*\n\n" +

        "👤 *Profile*\n" +
        "`/profile` — View your profile\n" +
        "`/setprofile name | Alice` — Update name\n" +
        "`/setprofile profession | Designer` — Update profession\n" +
        "`/setprofile city | Mumbai` — Update city\n\n" +

        "🎭 *Personas*\n" +
        "`/personas` — List built-in + your custom personas\n" +
        "`/persona use ceo` — Switch to a persona\n" +
        "`/persona clear` — Back to default behavior\n" +
        "`/persona create my-coach | Sales Coach | VP Sales` — Guided creation\n" +
        "`/persona clone ceo my-ceo` — Clone a built-in to edit\n" +
        "`/persona show <id>` — View persona config\n" +
        "`/persona edit <id> tone | <value>` — Update one field\n" +
        "`/persona delete <id>` — Remove a custom persona\n\n" +

        "📰 *News* _(3 tokens)_\n" +
        "`/news` — Fetch & summarise today's top headlines\n\n" +

        "📧 *Email* _(fetch: 3 tokens · send: 1 token)_\n" +
        "`/mails` — Fetch & analyse your inbox\n" +
        "`/mails user@gmail.com` — Fetch from a specific account\n" +
        "`/readmail 3` — Read email #3 in full\n" +
        "`/send to@email.com | Subject | Body` — Send email\n" +
        "`/connectmail` — Connect a new email account\n" +
        "`/disconnectmail` — Remove an account\n" +
        "`/accounts` — List connected accounts\n" +
        "`/setdefault user@gmail.com` — Change default account\n\n" +

        "⚙️ *Preferences*\n" +
        "`/preferences` — View all preferences\n" +
        "`/setpref emailfocus | jobs, finance` — Set email focus\n" +
        "`/setpref newscategories | technology, sports` — Set news topics\n" +
        "`/setpref newscount | 15` — Number of news articles\n" +
        "`/setpref emailcount | 20` — Emails to fetch\n" +
        "`/briefing` — View daily briefing settings\n" +
        "`/setbriefing both` — News + mails at 9 AM IST\n" +
        "`/setbriefing none` — Disable daily briefing\n\n" +

        "📂 *Files* _(upload: 3 tokens · download: 2 tokens)_\n" +
        "_Send any file in chat_ — AI reads + analyses it\n" +
        "`/files` — List saved files\n" +
        "`/activefile report.pdf` — Include in chat context\n" +
        "`/inactivefile report.pdf` — Remove from chat context\n" +
        "`/download report.pdf` — Get updated file back\n" +
        "`/removefile report.pdf` — Delete permanently\n" +
        "`/clearfiles` — Delete all files\n\n" +

        "📱 *Phone Control* _(5 tokens)_\n" +
        "`/connectphone https://url.ngrok.io secret` — Link bridge\n" +
        "`/apps` — Show installed apps\n" +
        "`/phoneaccess all` — Allow all apps\n" +
        "`/phoneaccess only com.whatsapp` — Restrict to one app\n" +
        "`/phone Open WhatsApp and message Mom` — Run a task\n" +
        "`/disconnectphone` — Unlink phone\n\n" +

        "📊 *Quota*\n" +
        "`/usage` — Check daily token usage\n" +
        "`/requestquota I use this for work` — Request more tokens\n" +
        "`/requestlimit need more msgs/min` — Request higher rate limit\n\n" +

        "🔧 *Other*\n" +
        "`/reset` — Clear chat history\n" +
        "`/deleteaccount` — Delete your account permanently\n\n" +

        "_Just chat normally for AI help — no commands needed._",
        chatId
      );
      return NextResponse.json({ ok: true });
    }

    // ─── COMMAND: /usage ──────────────────────────────────────────
    if (text === "/usage") {
      const remaining = Math.max(0, user.quotaLimit - user.quotaUsed);
      const pct = Math.round((user.quotaUsed / user.quotaLimit) * 100);
      const bar = "█".repeat(Math.round(pct / 10)) + "░".repeat(10 - Math.round(pct / 10));

      await sendTelegramMessage(
        `📊 *Your Usage Today*\n\n` +
        `${bar} ${pct}%\n\n` +
        `Used: ${user.quotaUsed} / ${user.quotaLimit} tokens\n` +
        `Remaining: ${remaining} tokens\n\n` +
        `_Resets at midnight IST_\n\n` +
        `*Rate limit:* ${user.rateLimit || 5} messages/min\n\n` +
        `*Token costs:*\n` +
        `• Chat message — 1 token\n` +
        `• /news — 3 tokens\n` +
        `• /mails — 3 tokens\n` +
        `• /send — 1 token\n` +
        `• File upload — 3 tokens\n` +
        `• /download — 2 tokens\n` +
        `• /phone — 5 tokens`,
        chatId
      );
      return NextResponse.json({ ok: true });
    }

    // ─── COMMAND: /requestquota ────────────────────────────────────
    if (text.startsWith("/requestquota")) {
      const note = text.replace("/requestquota", "").trim();

      if (user.quotaRequested) {
        await sendTelegramMessage(
          "⏳ You already have a pending quota request. Please wait for admin approval.",
          chatId
        );
        return NextResponse.json({ ok: true });
      }

      await User.updateOne(
        { chatId: String(chatId) },
        { $set: { quotaRequested: true, quotaRequestNote: note || "No reason provided" } }
      );

      // Notify admin
      await sendTelegramMessage(
        `🔔 *Quota Request*\n\n` +
        `User: ${user.name} (@${user.username || "no username"})\n` +
        `ChatId: \`${chatId}\`\n` +
        `Current limit: ${user.quotaLimit} tokens/day\n` +
        `Used today: ${user.quotaUsed}\n` +
        `Reason: ${note || "No reason provided"}\n\n` +
        `To approve:\n` +
        `/setquota ${chatId} <amount>\n\n` +
        `To deny:\n` +
        `/denyquota ${chatId}`,
        process.env.ADMIN_CHAT_ID
      );

      await sendTelegramMessage(
        "✅ Quota request sent! The admin will review it shortly.",
        chatId
      );
      return NextResponse.json({ ok: true });
    }

    // ─── COMMAND: /requestlimit ───────────────────────────────────
    if (text.startsWith("/requestlimit")) {
      const note = text.replace("/requestlimit", "").trim();

      if (user.rateLimitRequested) {
        await sendTelegramMessage(
          "⏳ You already have a pending rate limit request. Please wait for admin approval.",
          chatId
        );
        return NextResponse.json({ ok: true });
      }

      await User.updateOne(
        { chatId: String(chatId) },
        { $set: { rateLimitRequested: true, rateLimitRequestNote: note || "No reason provided" } }
      );

      // Notify admin
      await sendTelegramMessage(
        `🔔 *Rate Limit Request*\n\n` +
        `User: ${user.name} (@${user.username || "no username"})\n` +
        `ChatId: \`${chatId}\`\n` +
        `Current limit: ${user.rateLimit}/min\n` +
        `Reason: ${note || "No reason provided"}\n\n` +
        `To approve:\n` +
        `/setlimit ${chatId} <amount>\n\n` +
        `To deny:\n` +
        `/denylimit ${chatId}`,
        process.env.ADMIN_CHAT_ID
      );

      await sendTelegramMessage(
        "✅ Rate limit request sent! The admin will review it shortly.",
        chatId
      );
      return NextResponse.json({ ok: true });
    }

    // ─── COMMAND: /profile ─────────────────────────────────────────
    if (text === "/profile") {
      const activePersona = getActivePersona(user);
      const personaLine = activePersona
        ? `\nActive persona: *${activePersona.displayName}* (\`${activePersona.id}\`)`
        : "";
      await sendTelegramMessage(
        `👤 *Your Profile*\n\n` +
        `Name: ${user.name}\n` +
        `Profession: ${user.profession}\n` +
        `City: ${user.city}\n` +
        `Interests: ${user.interests}\n` +
        `Response Style: ${user.responseStyle}` +
        personaLine,
        chatId
      );
      return NextResponse.json({ ok: true });
    }

    // ─── COMMAND: /deleteaccount ──────────────────────────────────
    if (text === "/deleteaccount") {
      await User.updateOne({ chatId: String(chatId) }, { $set: { pendingDelete: true } });
      await sendTelegramMessage(
        "⚠️ *Are you sure?*\n\n" +
        "This will permanently delete:\n" +
        "• Your profile and preferences\n" +
        "• All connected email accounts\n" +
        "• Chat history\n" +
        "• Quota and usage data\n\n" +
        "This action *cannot be undone*.\n\n" +
        "To confirm, send: `/deleteaccount CONFIRM`\n\n" +
        "_Type_ `cancel` _to go back._",
        chatId
      );
      return NextResponse.json({ ok: true });
    }

    if (text === "/deleteaccount CONFIRM") {
      await User.deleteOne({ chatId: String(chatId) });
      await sendTelegramMessage(
        "✅ Your account and all associated data have been permanently deleted.\n\n" +
        "Send /start if you ever want to come back.",
        chatId
      );
      return NextResponse.json({ ok: true });
    }

    // ─── COMMAND: /setprofile ──────────────────────────────────────
    if (text.startsWith("/setprofile")) {
      const parts = text.replace("/setprofile", "").trim().split("|");
      if (parts.length < 2) {
        await sendTelegramMessage(
          "❌ Format: `/setprofile field | value`\n\nFields: name, profession, city, interests, style",
          chatId
        );
        return NextResponse.json({ ok: true });
      }

      const fieldMap = {
        name: "name", profession: "profession", city: "city",
        interests: "interests", style: "responseStyle",
      };

      const field = parts[0].trim().toLowerCase();
      const value = parts[1].trim();

      if (!fieldMap[field]) {
        await sendTelegramMessage(
          "❌ Unknown field. Valid fields: name, profession, city, interests, style",
          chatId
        );
        return NextResponse.json({ ok: true });
      }

      await User.updateOne({ chatId: String(chatId) }, { $set: { [fieldMap[field]]: value } });
      await sendTelegramMessage(`✅ Updated your ${field} to: *${value}*`, chatId);
      return NextResponse.json({ ok: true });
    }

    // ─── COMMAND: /reset ───────────────────────────────────────────
    if (text === "/reset") {
      user.history = [];
      await user.save();
      await sendTelegramMessage("🧹 Chat history cleared! How can I help you now?", chatId);
      return NextResponse.json({ ok: true });
    }

    // ─── COMMAND: /preferences ────────────────────────────────────
    if (text === "/preferences") {
      const cats  = (user.newsCategories || ["technology", "general"]).join(", ");
      const focus = (user.emailFocus || ["jobs", "finance"]).join(", ");

      const briefingType = user.briefing?.type || "both";
      const briefingLabel = { both: "News + Mails", news: "News only", mails: "Mails only", none: "Off" };

      await sendTelegramMessage(
        `⚙️ *Your Preferences*\n\n` +
        `📰 *News*\n` +
        `• Categories: ${cats}\n` +
        `• Total articles: ${user.newsCount || 10}\n\n` +
        `📧 *Email*\n` +
        `• Emails to fetch: ${user.emailCount || 10}\n` +
        `• Focus areas: ${focus}\n\n` +
        `📬 *Daily Briefing (9:00 AM IST)*\n` +
        `• Content: ${briefingLabel[briefingType] || briefingType}\n\n` +
        `*How to update:*\n` +
        `/setpref newscount | 15\n` +
        `/setpref newscategories | technology, sports, business\n` +
        `/setpref emailcount | 30\n` +
        `/setpref emailfocus | jobs, finance, newsletters\n` +
        `/setbriefing both — set briefing content\n\n` +
        `*Valid news categories:* technology, business, sports, health, science, entertainment, general\n` +
        `*Valid email focus:* jobs, finance, newsletters, promotions, social, updates, all\n` +
        `*Valid briefing types:* both, news, mails, none`,
        chatId
      );
      return NextResponse.json({ ok: true });
    }

    // ─── COMMAND: /setpref ─────────────────────────────────────────
    if (text.startsWith("/setpref")) {
      const parts = text.replace("/setpref", "").trim().split("|");
      if (parts.length < 2) {
        await sendTelegramMessage(
          "❌ Format: `/setpref field | value`\n\nRun /preferences to see all options.",
          chatId
        );
        return NextResponse.json({ ok: true });
      }

      const field = parts[0].trim().toLowerCase();
      const value = parts[1].trim();

      if (field === "newscount") {
        const n = parseInt(value, 10);
        if (isNaN(n) || n < 1 || n > 50) {
          await sendTelegramMessage("❌ newscount must be a number between 1 and 50.", chatId);
          return NextResponse.json({ ok: true });
        }
        await User.updateOne({ chatId: String(chatId) }, { $set: { newsCount: n } });
        await sendTelegramMessage(`✅ News count set to *${n}* articles.`, chatId);

      } else if (field === "newscategories") {
        const cats = value.split(",").map((c) => c.trim().toLowerCase()).filter(Boolean);
        const invalid = cats.filter((c) => !VALID_CATEGORIES.includes(c));
        if (invalid.length > 0) {
          await sendTelegramMessage(
            `❌ Invalid categories: ${invalid.join(", ")}\n\nValid: ${VALID_CATEGORIES.join(", ")}`,
            chatId
          );
          return NextResponse.json({ ok: true });
        }
        await User.updateOne({ chatId: String(chatId) }, { $set: { newsCategories: cats } });
        await sendTelegramMessage(`✅ News categories set to: *${cats.join(", ")}*`, chatId);

      } else if (field === "emailcount") {
        const n = parseInt(value, 10);
        if (isNaN(n) || n < 1 || n > 100) {
          await sendTelegramMessage("❌ emailcount must be a number between 1 and 100.", chatId);
          return NextResponse.json({ ok: true });
        }
        await User.updateOne({ chatId: String(chatId) }, { $set: { emailCount: n } });
        await sendTelegramMessage(`✅ Email fetch count set to *${n}* emails.`, chatId);

      } else if (field === "emailfocus") {
        const VALID_FOCUS = ["jobs", "finance", "newsletters", "promotions", "social", "updates", "all"];
        const focus = value.split(",").map((f) => f.trim().toLowerCase()).filter(Boolean);
        const invalid = focus.filter((f) => !VALID_FOCUS.includes(f));
        if (invalid.length > 0) {
          await sendTelegramMessage(
            `❌ Invalid focus areas: ${invalid.join(", ")}\n\nValid: ${VALID_FOCUS.join(", ")}`,
            chatId
          );
          return NextResponse.json({ ok: true });
        }
        await User.updateOne({ chatId: String(chatId) }, { $set: { emailFocus: focus } });
        await sendTelegramMessage(`✅ Email focus set to: *${focus.join(", ")}*`, chatId);

      } else {
        await sendTelegramMessage(
          "❌ Unknown preference. Valid fields: newscount, newscategories, emailcount, emailfocus",
          chatId
        );
      }

      return NextResponse.json({ ok: true });
    }

    // ─── COMMAND: /briefing ──────────────────────────────────────────
    if (text === "/briefing") {
      const briefingType = user.briefing?.type || "both";
      const briefingLabel = { both: "News + Mails", news: "News only", mails: "Mails only", none: "Off" };

      await sendTelegramMessage(
        `📬 *Daily Briefing Settings*\n\n` +
        `Content: *${briefingLabel[briefingType] || briefingType}*\n` +
        `Time: *9:00 AM IST* daily\n` +
        `Status: ${briefingType === "none" ? "❌ Disabled" : "✅ Active"}\n\n` +
        `*Change with:*\n` +
        `/setbriefing both — news + mails\n` +
        `/setbriefing news — news only\n` +
        `/setbriefing mails — mails only\n` +
        `/setbriefing none — turn off daily briefing`,
        chatId
      );
      return NextResponse.json({ ok: true });
    }

    // ─── COMMAND: /setbriefing ────────────────────────────────────────
    if (text.startsWith("/setbriefing")) {
      const type = text.replace("/setbriefing", "").trim().toLowerCase();

      if (!type) {
        await sendTelegramMessage(
          "❌ Format: `/setbriefing <type>`\n\n" +
          "Types: *both*, *news*, *mails*, *none*\n\n" +
          "Examples:\n" +
          "`/setbriefing both` — news + mails\n" +
          "`/setbriefing news` — news only\n" +
          "`/setbriefing none` — disable daily briefing",
          chatId
        );
        return NextResponse.json({ ok: true });
      }

      const VALID_TYPES = ["both", "news", "mails", "none"];
      if (!VALID_TYPES.includes(type)) {
        await sendTelegramMessage(
          `❌ Invalid type: ${type}\n\nValid: both, news, mails, none`,
          chatId
        );
        return NextResponse.json({ ok: true });
      }

      await User.updateOne({ chatId: String(chatId) }, { $set: { "briefing.type": type } });

      const briefingLabel = { both: "News + Mails", news: "News only", mails: "Mails only", none: "Off" };

      if (type === "none") {
        await sendTelegramMessage("✅ Daily briefing *disabled*. You won't receive automatic updates.", chatId);
      } else {
        await sendTelegramMessage(
          `✅ Daily briefing updated!\n\n` +
          `Content: *${briefingLabel[type]}*\n` +
          `Time: *9:00 AM IST* daily`,
          chatId
        );
      }
      return NextResponse.json({ ok: true });
    }

    // ─── COMMAND: /personas ────────────────────────────────────────
    if (text === "/personas") {
      const activeId = user.activePersonaId;
      const customs  = user.personas || [];

      const formatLine = (p, kind) => {
        const active = p.id === activeId ? " ✅" : "";
        return `• *${p.displayName}* — \`${p.id}\`${active} _(${kind})_`;
      };

      const lines = [];
      lines.push("🎭 *Personas*\n");
      lines.push("*Built-in:*");
      BUILT_IN_PERSONAS.forEach((p) => lines.push(formatLine(p, "built-in")));
      lines.push("");
      lines.push("*Your custom personas:*");
      if (customs.length === 0) {
        lines.push("_(none yet)_");
      } else {
        customs.forEach((p) => lines.push(formatLine(p, "custom")));
      }
      lines.push("");
      lines.push("*Commands:*");
      lines.push("`/persona use <id>` — activate a persona");
      lines.push("`/persona clear` — back to default behavior");
      lines.push("`/persona show <id>` — view full config");
      lines.push("`/persona create <id> | <name> | <role>` — guided creation");
      lines.push("`/persona clone <built-in-id> <new-id>` — copy built-in to edit");
      lines.push("`/persona edit <id> <field> | <value>` — update one field");
      lines.push("`/persona delete <id>` — remove a custom persona");

      await sendTelegramMessage(lines.join("\n"), chatId);
      return NextResponse.json({ ok: true });
    }

    // ─── COMMAND: /persona ... ─────────────────────────────────────
    if (text.startsWith("/persona ") || text === "/persona") {
      const arg = text.replace("/persona", "").trim();

      if (!arg) {
        await sendTelegramMessage(
          "❌ Usage: `/persona <subcommand>`\n\n" +
          "Subcommands: `use`, `clear`, `show`, `create`, `clone`, `edit`, `delete`\n\n" +
          "Run `/personas` to see available personas.",
          chatId
        );
        return NextResponse.json({ ok: true });
      }

      const SLUG_RE = /^[a-z0-9-]{2,30}$/;
      const findPersona = (id) => getBuiltInPersona(id) || (user.personas || []).find((p) => p.id === id);
      const findCustomIndex = (id) => (user.personas || []).findIndex((p) => p.id === id);

      // /persona use <id>
      if (arg.startsWith("use ") || arg === "use") {
        const id = arg.replace("use", "").trim();
        if (!id) {
          await sendTelegramMessage("❌ Usage: `/persona use <id>` — see `/personas` for ids.", chatId);
          return NextResponse.json({ ok: true });
        }
        const persona = findPersona(id);
        if (!persona) {
          await sendTelegramMessage(`❌ No persona with id \`${id}\`. Run \`/personas\` to see options.`, chatId);
          return NextResponse.json({ ok: true });
        }
        await User.updateOne({ chatId: String(chatId) }, { $set: { activePersonaId: id } });
        await sendTelegramMessage(
          `✅ Persona switched to *${persona.displayName}*.\n\n` +
          `Try chatting now to feel the change. To revert: \`/persona clear\``,
          chatId
        );
        return NextResponse.json({ ok: true });
      }

      // /persona clear
      if (arg === "clear") {
        await User.updateOne({ chatId: String(chatId) }, { $set: { activePersonaId: null } });
        await sendTelegramMessage(
          "✅ Persona cleared. The bot will use your default profile-based responses.\n\n" +
          "_Example:_ `/personas` to switch back anytime.",
          chatId
        );
        return NextResponse.json({ ok: true });
      }

      // /persona show <id>
      if (arg.startsWith("show ") || arg === "show") {
        const id = arg.replace("show", "").trim();
        if (!id) {
          await sendTelegramMessage("❌ Usage: `/persona show <id>`", chatId);
          return NextResponse.json({ ok: true });
        }
        const persona = findPersona(id);
        if (!persona) {
          await sendTelegramMessage(`❌ No persona with id \`${id}\`.`, chatId);
          return NextResponse.json({ ok: true });
        }
        const fmt = (label, val) => val ? `${label}: ${Array.isArray(val) ? val.join(", ") : val}\n` : "";
        await sendTelegramMessage(
          `🎭 *${persona.displayName}* (\`${persona.id}\`)\n\n` +
          fmt("Role", persona.role) +
          fmt("Expertise", persona.expertise) +
          fmt("Experience", persona.experienceYears ? `${persona.experienceYears} years` : null) +
          fmt("Industry", persona.industry) +
          fmt("Tone", persona.tone) +
          fmt("Response style", persona.responseStyle) +
          `Type: ${persona.isBuiltIn ? "built-in (read-only)" : "custom"}`,
          chatId
        );
        return NextResponse.json({ ok: true });
      }

      // /persona create <id> | <displayName> | <role>
      if (arg.startsWith("create ") || arg === "create") {
        const rest = arg.replace("create", "").trim();
        const parts = rest.split("|").map((s) => s.trim());
        if (parts.length < 3 || parts.some((p) => !p)) {
          await sendTelegramMessage(
            "❌ Format: `/persona create <id> | <displayName> | <role>`\n\n" +
            "_Example:_ `/persona create my-coach | Sales Coach | VP Sales`",
            chatId
          );
          return NextResponse.json({ ok: true });
        }
        const [id, displayName, role] = parts;
        if (!SLUG_RE.test(id)) {
          await sendTelegramMessage(
            "❌ Invalid id. Use 2-30 chars, lowercase letters/numbers/hyphens only.\n\n" +
            "_Example:_ `my-coach`, `sales-vp`, `ceo2`",
            chatId
          );
          return NextResponse.json({ ok: true });
        }
        if (isBuiltInId(id)) {
          await sendTelegramMessage(`❌ \`${id}\` collides with a built-in persona id. Pick another.`, chatId);
          return NextResponse.json({ ok: true });
        }
        if (displayName.length > 50) {
          await sendTelegramMessage("❌ displayName must be ≤50 chars.", chatId);
          return NextResponse.json({ ok: true });
        }
        if (role.length > 100) {
          await sendTelegramMessage("❌ role must be ≤100 chars.", chatId);
          return NextResponse.json({ ok: true });
        }
        if ((user.personas || []).some((p) => p.id === id)) {
          await sendTelegramMessage(`❌ A persona with id \`${id}\` already exists.`, chatId);
          return NextResponse.json({ ok: true });
        }
        if ((user.personas || []).length >= 10) {
          await sendTelegramMessage(
            "❌ You've hit the *10 custom persona* cap. Delete one with `/persona delete <id>` first.",
            chatId
          );
          return NextResponse.json({ ok: true });
        }
        await startPersonaSetup(user, chatId, { id, displayName, role });
        return NextResponse.json({ ok: true });
      }

      // /persona clone <built-in-id> <new-id>
      if (arg.startsWith("clone ") || arg === "clone") {
        const rest = arg.replace("clone", "").trim();
        const tokens = rest.split(/\s+/).filter(Boolean);
        if (tokens.length !== 2) {
          await sendTelegramMessage(
            "❌ Format: `/persona clone <built-in-id> <new-id>`\n\n" +
            "_Example:_ `/persona clone ceo my-ceo`",
            chatId
          );
          return NextResponse.json({ ok: true });
        }
        const [srcId, newId] = tokens;
        const src = getBuiltInPersona(srcId);
        if (!src) {
          await sendTelegramMessage(`❌ \`${srcId}\` is not a built-in persona. Run \`/personas\`.`, chatId);
          return NextResponse.json({ ok: true });
        }
        if (!SLUG_RE.test(newId)) {
          await sendTelegramMessage(
            "❌ Invalid new id. Use 2-30 chars, lowercase letters/numbers/hyphens only.",
            chatId
          );
          return NextResponse.json({ ok: true });
        }
        if (isBuiltInId(newId) || (user.personas || []).some((p) => p.id === newId)) {
          await sendTelegramMessage(`❌ Id \`${newId}\` already exists.`, chatId);
          return NextResponse.json({ ok: true });
        }
        if ((user.personas || []).length >= 10) {
          await sendTelegramMessage(
            "❌ You've hit the *10 custom persona* cap. Delete one with `/persona delete <id>` first.",
            chatId
          );
          return NextResponse.json({ ok: true });
        }
        const cloned = {
          id: newId,
          displayName: src.displayName,
          role: src.role,
          expertise: [...(src.expertise || [])],
          experienceYears: src.experienceYears ?? null,
          industry: src.industry || null,
          tone: src.tone || null,
          responseStyle: src.responseStyle || null,
          isBuiltIn: false,
          createdAt: new Date(),
        };
        await User.updateOne({ chatId: String(chatId) }, { $push: { personas: cloned } });
        await sendTelegramMessage(
          `✅ Cloned built-in *${src.displayName}* to your personas as \`${newId}\`.\n\n` +
          `To activate: \`/persona use ${newId}\`\n` +
          `To customise: \`/persona edit ${newId} tone | <new tone>\``,
          chatId
        );
        return NextResponse.json({ ok: true });
      }

      // /persona edit <id> <field> | <value>
      if (arg.startsWith("edit ") || arg === "edit") {
        const rest = arg.replace("edit", "").trim();
        // Split: "<id> <field> | <value>"
        const pipeIdx = rest.indexOf("|");
        if (pipeIdx === -1) {
          await sendTelegramMessage(
            "❌ Format: `/persona edit <id> <field> | <value>`\n\n" +
            "Fields: `displayName`, `role`, `expertise`, `experienceYears`, `industry`, `tone`, `responseStyle`\n\n" +
            "_Example:_ `/persona edit my-coach tone | warm and encouraging`",
            chatId
          );
          return NextResponse.json({ ok: true });
        }
        const left  = rest.slice(0, pipeIdx).trim();
        const value = rest.slice(pipeIdx + 1).trim();
        const tokens = left.split(/\s+/);
        if (tokens.length !== 2) {
          await sendTelegramMessage("❌ Format: `/persona edit <id> <field> | <value>`", chatId);
          return NextResponse.json({ ok: true });
        }
        const [id, field] = tokens;

        if (isBuiltInId(id)) {
          await sendTelegramMessage(
            `❌ Built-in personas can't be edited. Clone first:\n\n\`/persona clone ${id} my-${id}\``,
            chatId
          );
          return NextResponse.json({ ok: true });
        }

        const idx = findCustomIndex(id);
        if (idx === -1) {
          await sendTelegramMessage(`❌ No custom persona with id \`${id}\`.`, chatId);
          return NextResponse.json({ ok: true });
        }

        const FIELD_RULES = {
          displayName:     { max: 50 },
          role:            { max: 100 },
          tone:            { max: 200 },
          responseStyle:   { max: 200 },
          industry:        { max: 100 },
          expertise:       { array: true, maxItems: 10, maxItemLen: 50 },
          experienceYears: { number: true, min: 0, max: 80 },
        };
        const rule = FIELD_RULES[field];
        if (!rule) {
          await sendTelegramMessage(
            "❌ Unknown field. Valid: `displayName`, `role`, `expertise`, `experienceYears`, `industry`, `tone`, `responseStyle`",
            chatId
          );
          return NextResponse.json({ ok: true });
        }

        let newValue;
        if (rule.array) {
          const items = value.split(",").map((s) => s.trim()).filter(Boolean);
          if (items.length > rule.maxItems) {
            await sendTelegramMessage(`❌ Max ${rule.maxItems} items.`, chatId);
            return NextResponse.json({ ok: true });
          }
          if (items.some((i) => i.length > rule.maxItemLen)) {
            await sendTelegramMessage(`❌ Each item must be ≤${rule.maxItemLen} chars.`, chatId);
            return NextResponse.json({ ok: true });
          }
          newValue = items;
        } else if (rule.number) {
          const n = parseInt(value, 10);
          if (Number.isNaN(n) || n < rule.min || n > rule.max) {
            await sendTelegramMessage(`❌ Must be a number between ${rule.min} and ${rule.max}.`, chatId);
            return NextResponse.json({ ok: true });
          }
          newValue = n;
        } else {
          if (value.length > rule.max) {
            await sendTelegramMessage(`❌ ${field} must be ≤${rule.max} chars.`, chatId);
            return NextResponse.json({ ok: true });
          }
          newValue = value;
        }

        await User.updateOne(
          { chatId: String(chatId) },
          { $set: { [`personas.${idx}.${field}`]: newValue } }
        );
        await sendTelegramMessage(`✅ Updated *${id}*'s ${field}.`, chatId);
        return NextResponse.json({ ok: true });
      }

      // /persona delete <id>
      if (arg.startsWith("delete ") || arg === "delete") {
        const id = arg.replace("delete", "").trim();
        if (!id) {
          await sendTelegramMessage("❌ Usage: `/persona delete <id>`", chatId);
          return NextResponse.json({ ok: true });
        }
        if (isBuiltInId(id)) {
          await sendTelegramMessage("❌ Built-in personas can't be deleted.", chatId);
          return NextResponse.json({ ok: true });
        }
        if (findCustomIndex(id) === -1) {
          await sendTelegramMessage(`❌ No custom persona with id \`${id}\`.`, chatId);
          return NextResponse.json({ ok: true });
        }
        const update = { $pull: { personas: { id } } };
        if (user.activePersonaId === id) update.$set = { activePersonaId: null };
        await User.updateOne({ chatId: String(chatId) }, update);
        await sendTelegramMessage(`✅ Deleted persona \`${id}\`.`, chatId);
        return NextResponse.json({ ok: true });
      }

      await sendTelegramMessage(
        "❌ Unknown subcommand.\n\n" +
        "Valid: `use`, `clear`, `show`, `create`, `clone`, `edit`, `delete`\n\n" +
        "Run `/personas` to see available personas.",
        chatId
      );
      return NextResponse.json({ ok: true });
    }

    // ─── COMMAND: /news ────────────────────────────────────────────
    if (text === "/news") {
      const newsQuota = await checkQuota(user, "news");
      if (!newsQuota.allowed) {
        await sendTelegramMessage(newsQuota.message, chatId);
        return NextResponse.json({ ok: true });
      }

      await sendTelegramMessage("⏳ Fetching news and generating summary...", chatId);
      const keepTypingNews = setInterval(sendTyping, 4000);

      try {
        const news = await withTimeout(
          getTopNews(user.newsCategories || ["technology", "general"], user.newsCount || 10),
          15000
        );

        clearInterval(keepTypingNews);

        if (news.length === 0) {
          await sendTelegramMessage("😕 No news found right now. Try again later.", chatId);
          return NextResponse.json({ ok: true });
        }

        const summary = await generateSummary({ emails: [], news }, user);
        const header  = `🤖 *Daily Briefing — ${new Date().toLocaleDateString("en-IN", {
          weekday: "long", year: "numeric", month: "long", day: "numeric",
        })}*\n\n`;

        await deductQuota(user, "news");
        await sendTelegramMessage(header + summary + (newsQuota.warning || ""), chatId);
      } catch (err) {
        clearInterval(keepTypingNews);
        if (err.message === "__timeout__") {
          await sendTelegramMessage(
            "⏱ News fetch is taking too long. Your news provider may be slow — try again in a moment.",
            chatId
          );
        } else {
          console.error("[News Command Error]:", err.message);
          await sendTelegramMessage("❌ Couldn't fetch news right now. Please try again.", chatId);
        }
      }

      return NextResponse.json({ ok: true });
    }

    // ─── COMMAND: /accounts ────────────────────────────────────────
    if (text === "/accounts") {
      if (user.emailAccounts.length === 0) {
        await sendTelegramMessage(
          "📭 No email accounts connected.\nRun /connectmail to add one.",
          chatId
        );
        return NextResponse.json({ ok: true });
      }

      await sendTelegramMessage(
        `📧 *Connected email accounts:*\n\n${formatAccountList(user.emailAccounts)}\n\n` +
        `⭐ = default account\n\n` +
        `Use /setdefault email@address to change default.\n` +
        `Use /disconnectmail email@address to remove one.`,
        chatId
      );
      return NextResponse.json({ ok: true });
    }

    // ─── COMMAND: /setdefault ──────────────────────────────────────
    if (text.startsWith("/setdefault")) {
      const targetEmail = text.replace("/setdefault", "").trim();

      if (!targetEmail) {
        await sendTelegramMessage("❌ Format: `/setdefault email@address`", chatId);
        return NextResponse.json({ ok: true });
      }

      const account = findAccountByEmail(user, targetEmail);
      if (!account) {
        await sendTelegramMessage(
          `❌ No account found for ${targetEmail}.\nUse /accounts to see your connected accounts.`,
          chatId
        );
        return NextResponse.json({ ok: true });
      }

      // Clear all defaults, then set the target
      await User.updateOne(
        { chatId: String(chatId) },
        { $set: { "emailAccounts.$[].isDefault": false } }
      );
      await User.updateOne(
        { chatId: String(chatId) },
        { $set: { "emailAccounts.$[acct].isDefault": true } },
        { arrayFilters: [{ "acct.emailAddress": account.emailAddress }] }
      );

      await sendTelegramMessage(`⭐ Default account set to: *${account.emailAddress}*`, chatId);
      return NextResponse.json({ ok: true });
    }

    // ─── COMMAND: /connectmail ─────────────────────────────────────
    if (text === "/connectmail") {
      let intro = "";
      if (user.emailAccounts.length > 0) {
        intro = `📧 *Currently connected:*\n${formatAccountList(user.emailAccounts)}\n\n`;
      }

      await User.updateOne(
        { chatId: String(chatId) },
        { $set: { emailSetupPending: true, emailSetupStep: 0 } }
      );

      await sendTelegramMessage(
        `${intro}Which provider do you want to add?\n\n` +
        `1️⃣ Gmail\n2️⃣ Outlook / Hotmail\n3️⃣ Yahoo Mail\n4️⃣ Apple iCloud\n5️⃣ Other\n\n` +
        `Reply with: gmail / outlook / yahoo / icloud / other` +
        ESCAPE_HINT,
        chatId
      );
      return NextResponse.json({ ok: true });
    }

    // ─── COMMAND: /disconnectmail ──────────────────────────────────
    if (text.startsWith("/disconnectmail")) {
      const targetEmail = text.replace("/disconnectmail", "").trim();

      if (user.emailAccounts.length === 0) {
        await sendTelegramMessage("📭 No email accounts connected.", chatId);
        return NextResponse.json({ ok: true });
      }

      // No email specified + multiple accounts → show list
      if (!targetEmail && user.emailAccounts.length > 1) {
        await sendTelegramMessage(
          `📧 *Which account do you want to disconnect?*\n\n${formatAccountList(user.emailAccounts)}\n\n` +
          `Use: /disconnectmail email@address`,
          chatId
        );
        return NextResponse.json({ ok: true });
      }

      // Resolve which account to remove
      const account = targetEmail
        ? findAccountByEmail(user, targetEmail)
        : user.emailAccounts[0];

      if (!account) {
        await sendTelegramMessage(
          `❌ No account found for ${targetEmail}.\nUse /accounts to see your connected accounts.`,
          chatId
        );
        return NextResponse.json({ ok: true });
      }

      await User.updateOne(
        { chatId: String(chatId) },
        { $pull: { emailAccounts: { _id: account._id } } }
      );

      // If removed account was default and others remain, promote the first
      const updatedUser = await User.findOne({ chatId: String(chatId) });
      if (updatedUser.emailAccounts.length > 0) {
        const hasDefault = updatedUser.emailAccounts.some((a) => a.isDefault);
        if (!hasDefault) {
          await User.updateOne(
            { chatId: String(chatId) },
            { $set: { "emailAccounts.$[acct].isDefault": true } },
            { arrayFilters: [{ "acct._id": updatedUser.emailAccounts[0]._id }] }
          );
        }
      }

      await sendTelegramMessage(
        `✅ *${account.emailAddress || account.provider || "Account"}* disconnected. All credentials removed.`,
        chatId
      );
      return NextResponse.json({ ok: true });
    }

    // ─── COMMAND: /mails ───────────────────────────────────────────
    if (text.startsWith("/mails")) {
      const mailsQuota = await checkQuota(user, "mails");
      if (!mailsQuota.allowed) {
        await sendTelegramMessage(mailsQuota.message, chatId);
        return NextResponse.json({ ok: true });
      }

      const targetEmail = text.replace("/mails", "").trim();

      const account = targetEmail
        ? findAccountByEmail(user, targetEmail)
        : getDefaultAccount(user);

      if (!account) {
        if (user.emailAccounts.length === 0) {
          await sendTelegramMessage(
            "📭 No email connected.\nRun /connectmail to get started.",
            chatId
          );
        } else {
          await sendTelegramMessage(
            `❌ No account found for ${targetEmail}.\nUse /accounts to see your connected accounts.`,
            chatId
          );
        }
        return NextResponse.json({ ok: true });
      }

      // Use emailAddress if available, fall back to provider name or generic label
      const accountLabel = account.emailAddress || account.provider || "your account";
      await sendTelegramMessage(`🔍 Fetching emails from *${accountLabel}*...`, chatId);
      const keepTypingMails = setInterval(sendTyping, 4000);

      try {
        const emails = await withTimeout(
          fetchEmails(account, chatId, user.emailCount || 10),
          20000
        );

        clearInterval(keepTypingMails);

        // Validate fetch result
        if (!Array.isArray(emails)) {
          await sendTelegramMessage(
            "❌ Unexpected response from your mail server. Try again or run /connectmail to re-authenticate.",
            chatId
          );
          return NextResponse.json({ ok: true });
        }

        // Empty inbox — don't call Gemini
        if (emails.length === 0) {
          await sendTelegramMessage(
            "📭 Your inbox is empty or no emails were found.\n\n" +
            "_If this seems wrong, check /preferences — you may have filters set that exclude most emails._",
            chatId
          );
          return NextResponse.json({ ok: true });
        }

        // Cache emails for /readmail
        emailCache.set(String(chatId), emails);

        const analysis = await analyzeEmails(emails, user);

        // Build a numbered list so the user knows which # to read
        const numberedList = emails.slice(0, 20).map((e, i) =>
          `${i + 1}. *${e.sender || e.from}* — ${e.subject || "(no subject)"}`
        ).join("\n");

        await deductQuota(user, "mails");
        await sendTelegramMessage(
          `📧 *Email Analysis — ${accountLabel}*\n\n${analysis}\n\n` +
          `📋 *Email List:*\n${numberedList}\n\n` +
          `_Use /readmail <number> to read full email_` +
          (mailsQuota.warning || ""),
          chatId
        );
      } catch (err) {
        clearInterval(keepTypingMails);
        if (err.message === "__timeout__") {
          await sendTelegramMessage(
            "⏱ Email fetch is taking too long. Your mail server may be slow.\n\nTry again or run /connectmail to re-authenticate.",
            chatId
          );
        } else {
          console.error("[Mails Command Error]:", err.message);
          await sendTelegramMessage(
            `❌ Couldn't fetch emails.\n\nError: ${err.message}\n\nTry /connectmail to re-authenticate your account.`,
            chatId
          );
        }
      }

      return NextResponse.json({ ok: true });
    }

    // ─── COMMAND: /readmail <number> ──────────────────────────────────
    if (text.startsWith("/readmail")) {
      if (!user.emailAccounts || user.emailAccounts.length === 0) {
        await sendTelegramMessage(
          "📭 No email account connected. Run /connectmail first.",
          chatId
        );
        return NextResponse.json({ ok: true });
      }

      const num = parseInt(text.replace("/readmail", "").trim(), 10);

      const cached = emailCache.get(String(chatId));
      if (!cached || cached.length === 0) {
        await sendTelegramMessage(
          "📭 No emails loaded. Run /mails first, then use `/readmail <number>`.",
          chatId
        );
        return NextResponse.json({ ok: true });
      }

      if (isNaN(num) || num < 1 || num > cached.length) {
        await sendTelegramMessage(
          `❌ Invalid number. Choose between 1 and ${cached.length}.\n\nExample: \`/readmail 1\``,
          chatId
        );
        return NextResponse.json({ ok: true });
      }

      const email = cached[num - 1];
      const body  = email.body?.trim() || email.preview?.trim() || "_(No content available)_";
      const date  = email.date ? new Date(email.date).toLocaleString("en-IN") : "Unknown";

      await sendTelegramMessage(
        `📧 *Email #${num}*\n\n` +
        `*From:* ${email.sender || email.from}\n` +
        `*Subject:* ${email.subject || "(no subject)"}\n` +
        `*Date:* ${date}\n\n` +
        `─────────────────\n\n` +
        body,
        chatId
      );
      return NextResponse.json({ ok: true });
    }

    // ─── COMMAND: /send ────────────────────────────────────────────
    if (text.startsWith("/send")) {
      const sendQuota = await checkQuota(user, "send");
      if (!sendQuota.allowed) {
        await sendTelegramMessage(sendQuota.message, chatId);
        return NextResponse.json({ ok: true });
      }

      const account = getDefaultAccount(user);

      if (!account) {
        await sendTelegramMessage("📭 No email connected. Run /connectmail first.", chatId);
        return NextResponse.json({ ok: true });
      }

      const parts = text.replace("/send", "").trim().split("|");
      if (parts.length < 3) {
        await sendTelegramMessage("❌ Format: `/send to@email.com | Subject | Body`", chatId);
        return NextResponse.json({ ok: true });
      }

      const to      = parts[0].trim();
      const subject = parts[1].trim();
      const body    = parts[2].trim();

      const sendFromLabel = account.emailAddress || account.provider || "your account";
      await sendTelegramMessage(`📤 Sending email from *${sendFromLabel}*...`, chatId);
      const keepTypingSend = setInterval(sendTyping, 4000);

      try {
        await withTimeout(sendEmail(account, chatId, { to, subject, body }), 15000);
        clearInterval(keepTypingSend);
        await deductQuota(user, "send");
        await sendTelegramMessage("✅ Email sent successfully!" + (sendQuota.warning || ""), chatId);
      } catch (err) {
        clearInterval(keepTypingSend);
        if (err.message === "__timeout__") {
          await sendTelegramMessage("⏱ Email send is taking too long. Your mail server may be slow. Try again.", chatId);
        } else {
          console.error("[Send Command Error]:", err.message);
          await sendTelegramMessage(`❌ Failed to send email: ${err.message}`, chatId);
        }
      }

      return NextResponse.json({ ok: true });
    }

    // ─── COMMAND: /connectphone ──────────────────────────────────────
    if (text.startsWith("/connectphone")) {
      const parts = text.replace("/connectphone", "").trim().split(/\s+/);
      if (parts.length < 2 || !parts[0]) {
        await sendTelegramMessage(
          "❌ Format: `/connectphone <bridge-url> <secret>`\n\n" +
          "Example: `/connectphone https://abc123.ngrok.io mysecret`\n\n" +
          "Run the bridge server first, then use the URL and secret it gives you.",
          chatId
        );
        return NextResponse.json({ ok: true });
      }

      const [bridgeUrl, bridgeSecret] = parts;

      await sendTelegramMessage("🔗 Checking bridge connection...", chatId);

      const healthy = await checkBridgeHealth(bridgeUrl);
      if (!healthy) {
        await sendTelegramMessage(
          "❌ Could not reach the bridge server. Make sure it's running and the URL is correct.",
          chatId
        );
        return NextResponse.json({ ok: true });
      }

      // Sync installed apps
      let installedApps = [];
      try {
        installedApps = await syncApps(bridgeUrl, bridgeSecret);
      } catch (err) {
        console.error("[ConnectPhone] App sync error:", err.message);
      }

      await User.updateOne(
        { chatId: String(chatId) },
        { $set: {
          "phoneAccess.enabled": true,
          "phoneAccess.bridgeUrl": bridgeUrl,
          "phoneAccess.bridgeSecret": bridgeSecret,
          "phoneAccess.installedApps": installedApps,
          "phoneAccess.lastSeen": new Date(),
        }}
      );

      await sendTelegramMessage(
        `✅ *Phone connected!*\n\n` +
        `Bridge: \`${bridgeUrl}\`\n` +
        `Apps found: ${installedApps.length}\n\n` +
        `Use /phone <task> to control your phone.\n` +
        `Use /apps to manage app permissions.`,
        chatId
      );
      return NextResponse.json({ ok: true });
    }

    // ─── COMMAND: /disconnectphone ────────────────────────────────────
    if (text === "/disconnectphone") {
      await User.updateOne(
        { chatId: String(chatId) },
        { $set: {
          "phoneAccess.enabled": false,
          "phoneAccess.bridgeUrl": null,
          "phoneAccess.bridgeSecret": null,
          "phoneAccess.installedApps": [],
        }}
      );

      await sendTelegramMessage("✅ Phone disconnected. Bridge unlinked.", chatId);
      return NextResponse.json({ ok: true });
    }

    // ─── COMMAND: /apps ───────────────────────────────────────────────
    if (text === "/apps") {
      if (!user.phoneAccess?.enabled) {
        await sendTelegramMessage(
          "📱 Phone not connected. Use /connectphone to link your bridge.",
          chatId
        );
        return NextResponse.json({ ok: true });
      }

      // Re-sync apps from bridge
      let apps = user.phoneAccess.installedApps || [];
      try {
        apps = await syncApps(user.phoneAccess.bridgeUrl, user.phoneAccess.bridgeSecret);
        await User.updateOne(
          { chatId: String(chatId) },
          { $set: { "phoneAccess.installedApps": apps, "phoneAccess.lastSeen": new Date() } }
        );
      } catch {
        // Use cached apps if bridge unreachable
      }

      if (apps.length === 0) {
        await sendTelegramMessage("📱 No apps found on your device.", chatId);
        return NextResponse.json({ ok: true });
      }

      const allowed = user.phoneAccess.allowedApps || ["*"];
      const allAllowed = allowed.includes("*");

      const list = apps.slice(0, 40).map((a) => {
        const status = allAllowed || allowed.includes(a.package) ? "✅" : "❌";
        return `${status} ${a.name} (\`${a.package}\`)`;
      }).join("\n");

      const remaining = apps.length > 40 ? `\n\n_...and ${apps.length - 40} more_` : "";

      await sendTelegramMessage(
        `📱 *Installed Apps (${apps.length})*\n\n` +
        `Access: ${allAllowed ? "All apps allowed" : `${allowed.length} apps allowed`}\n\n` +
        `${list}${remaining}\n\n` +
        `*Manage access:*\n` +
        `/phoneaccess all — Allow all apps\n` +
        `/phoneaccess only <package> — Allow only specific app`,
        chatId
      );
      return NextResponse.json({ ok: true });
    }

    // ─── COMMAND: /phoneaccess ────────────────────────────────────────
    if (text.startsWith("/phoneaccess")) {
      const args = text.replace("/phoneaccess", "").trim();

      if (!args) {
        await sendTelegramMessage(
          "❌ Usage:\n" +
          "`/phoneaccess all` — Allow all apps\n" +
          "`/phoneaccess only <package>` — Allow specific app (repeatable)",
          chatId
        );
        return NextResponse.json({ ok: true });
      }

      if (args === "all") {
        await User.updateOne(
          { chatId: String(chatId) },
          { $set: { "phoneAccess.allowedApps": ["*"] } }
        );
        await sendTelegramMessage("✅ All apps are now allowed.", chatId);
        return NextResponse.json({ ok: true });
      }

      if (args.startsWith("only ")) {
        const pkg = args.replace("only ", "").trim();
        if (!pkg) {
          await sendTelegramMessage("❌ Specify a package name: `/phoneaccess only com.whatsapp`", chatId);
          return NextResponse.json({ ok: true });
        }

        // Add to allowed list (remove '*' wildcard if present)
        const current = (user.phoneAccess?.allowedApps || []).filter((a) => a !== "*");
        if (!current.includes(pkg)) current.push(pkg);

        await User.updateOne(
          { chatId: String(chatId) },
          { $set: { "phoneAccess.allowedApps": current } }
        );
        await sendTelegramMessage(
          `✅ Added \`${pkg}\` to allowed apps.\n\nAllowed: ${current.join(", ")}`,
          chatId
        );
        return NextResponse.json({ ok: true });
      }

      await sendTelegramMessage(
        "❌ Unknown option. Use `/phoneaccess all` or `/phoneaccess only <package>`",
        chatId
      );
      return NextResponse.json({ ok: true });
    }

    // ─── COMMAND: /phone <task> ───────────────────────────────────────
    if (text.startsWith("/phone")) {
      const task = text.replace("/phone", "").trim();

      if (!task) {
        await sendTelegramMessage(
          "❌ Usage: `/phone <task>`\n\nExample: `/phone Open WhatsApp and send hello to Mom`",
          chatId
        );
        return NextResponse.json({ ok: true });
      }

      if (!user.phoneAccess?.enabled || !user.phoneAccess?.bridgeUrl) {
        await sendTelegramMessage(
          "📱 Phone not connected. Use /connectphone to link your bridge first.",
          chatId
        );
        return NextResponse.json({ ok: true });
      }

      const phoneQuota = await checkQuota(user, "phone");
      if (!phoneQuota.allowed) {
        await sendTelegramMessage(phoneQuota.message, chatId);
        return NextResponse.json({ ok: true });
      }

      // Refresh typing indicator every 4s during the full agent run
      const keepTypingPhone = setInterval(sendTyping, 4000);

      try {
        // Run the agent task (sends its own progress messages)
        await runPhoneTask({
          task,
          bridgeUrl:    user.phoneAccess.bridgeUrl,
          bridgeSecret: user.phoneAccess.bridgeSecret,
          allowedApps:  user.phoneAccess.allowedApps || ["*"],
          chatId,
        });
      } finally {
        clearInterval(keepTypingPhone);
      }

      await deductQuota(user, "phone");

      // Update last seen
      await User.updateOne(
        { chatId: String(chatId) },
        { $set: { "phoneAccess.lastSeen": new Date() } }
      );

      if (phoneQuota.warning) {
        await sendTelegramMessage(phoneQuota.warning, chatId);
      }

      return NextResponse.json({ ok: true });
    }

    // ─── COMMAND: /files ──────────────────────────────────────────────
    if (text === "/files") {
      if (!user.files || user.files.length === 0) {
        await sendTelegramMessage(
          "📂 No files saved yet.\n\nSend any file in chat to get started.",
          chatId
        );
        return NextResponse.json({ ok: true });
      }

      const list = user.files.map((f, i) =>
        `${i + 1}. *${f.name}* (${f.sizeKB || "?"}KB)\n` +
        `   _${f.summary || "No summary"}_\n` +
        `   ${f.isActive ? "✅ Active" : "⏸ Inactive"} · ${new Date(f.uploadedAt).toLocaleDateString("en-IN")}`
      ).join("\n\n");

      await sendTelegramMessage(
        `📂 *Your Files* (${user.files.length})\n\n${list}\n\n` +
        `Active files are included in every chat.\n` +
        `Use /activefile <name> or /inactivefile <name> to manage.`,
        chatId
      );
      return NextResponse.json({ ok: true });
    }

    // ─── COMMAND: /activefile <name> ──────────────────────────────────
    if (text.startsWith("/activefile")) {
      const name = text.replace("/activefile", "").trim();
      if (!name) {
        await sendTelegramMessage("❌ Format: `/activefile <filename>`", chatId);
        return NextResponse.json({ ok: true });
      }
      const file = user.files?.find((f) => f.name === name);
      if (!file) {
        await sendTelegramMessage(`❌ File "${name}" not found. Use /files to see your files.`, chatId);
        return NextResponse.json({ ok: true });
      }
      await User.updateOne(
        { chatId: String(chatId), "files.name": name },
        { $set: { "files.$.isActive": true } }
      );
      await sendTelegramMessage(`✅ *${name}* is now active — it will be included in your chat context.`, chatId);
      return NextResponse.json({ ok: true });
    }

    // ─── COMMAND: /inactivefile <name> ────────────────────────────────
    if (text.startsWith("/inactivefile")) {
      const name = text.replace("/inactivefile", "").trim();
      if (!name) {
        await sendTelegramMessage("❌ Format: `/inactivefile <filename>`", chatId);
        return NextResponse.json({ ok: true });
      }
      const file = user.files?.find((f) => f.name === name);
      if (!file) {
        await sendTelegramMessage(`❌ File "${name}" not found. Use /files to see your files.`, chatId);
        return NextResponse.json({ ok: true });
      }
      await User.updateOne(
        { chatId: String(chatId), "files.name": name },
        { $set: { "files.$.isActive": false } }
      );
      await sendTelegramMessage(`⏸ *${name}* removed from chat context.`, chatId);
      return NextResponse.json({ ok: true });
    }

    // ─── COMMAND: /removefile <name> ──────────────────────────────────
    if (text.startsWith("/removefile")) {
      const name = text.replace("/removefile", "").trim();
      if (!name) {
        await sendTelegramMessage("❌ Format: `/removefile <filename>`", chatId);
        return NextResponse.json({ ok: true });
      }
      const file = user.files?.find((f) => f.name === name);
      if (!file) {
        await sendTelegramMessage(`❌ File "${name}" not found. Use /files to see your files.`, chatId);
        return NextResponse.json({ ok: true });
      }
      if (file.gridfsId) {
        try { await deleteFileGridFS(file.gridfsId); } catch { /* ignore if already gone */ }
      }
      await User.updateOne({ chatId: String(chatId) }, { $pull: { files: { name } } });
      await sendTelegramMessage(`🗑 *${name}* deleted permanently.`, chatId);
      return NextResponse.json({ ok: true });
    }

    // ─── COMMAND: /clearfiles ─────────────────────────────────────────
    if (text === "/clearfiles") {
      const files = user.files || [];
      if (files.length === 0) {
        await sendTelegramMessage("📂 No files to delete.", chatId);
        return NextResponse.json({ ok: true });
      }
      await Promise.allSettled(
        files.filter((f) => f.gridfsId).map((f) => deleteFileGridFS(f.gridfsId))
      );
      await User.updateOne({ chatId: String(chatId) }, { $set: { files: [] } });
      await sendTelegramMessage(`🗑 All ${files.length} file(s) deleted permanently.`, chatId);
      return NextResponse.json({ ok: true });
    }

    // ─── COMMAND: /download <name> ────────────────────────────────────
    if (text.startsWith("/download")) {
      const name = text.replace("/download", "").trim();

      if (!name) {
        await sendTelegramMessage("❌ Format: `/download <filename>`\n\nUse /files to see your saved files.", chatId);
        return NextResponse.json({ ok: true });
      }

      const file = user.files?.find((f) => f.name === name);
      if (!file) {
        await sendTelegramMessage(`❌ File "${name}" not found.\n\nUse /files to see your saved files.`, chatId);
        return NextResponse.json({ ok: true });
      }

      const dlQuota = await checkQuota(user, "download");
      if (!dlQuota.allowed) {
        await sendTelegramMessage(dlQuota.message, chatId);
        return NextResponse.json({ ok: true });
      }

      await sendTelegramMessage("⏳ Generating your file...", chatId);
      const keepTypingDl = setInterval(sendTyping, 4000);

      try {
        const originalBuffer = await withTimeout(getFileGridFS(file.gridfsId), 10000);
        const { buffer: updatedBuffer, format } = await generateUpdatedFile(
          originalBuffer,
          file.extractedText || "",
          file.name,
          file.type
        );
        clearInterval(keepTypingDl);
        await sendTelegramFile(updatedBuffer, file.name, chatId);
        const formatLabel = {
          latex: "📄 Generated as LaTeX PDF (math/structured formatting detected).",
          pdf:   "📄 Generated as standard PDF.",
          docx:  "📄 Generated as DOCX.",
        }[format];
        if (formatLabel) await sendTelegramMessage(formatLabel, chatId);
        await deductQuota(user, "download");
        if (dlQuota.warning) await sendTelegramMessage(dlQuota.warning, chatId);
      } catch (err) {
        clearInterval(keepTypingDl);
        if (err.message === "__timeout__") {
          await sendTelegramMessage("⏱ File generation is taking too long. Try again.", chatId);
        } else {
          console.error("[Download Error]:", err.message);
          await sendTelegramMessage("❌ Couldn't generate file. Try again.", chatId);
        }
      }

      return NextResponse.json({ ok: true });
    }

    // ─── EMAIL SETUP STATE MACHINE ─────────────────────────────────
    if (user.emailSetupPending) {
      await handleEmailSetup(user, text, chatId);
      return NextResponse.json({ ok: true });
    }

    // ─── PERSONA SETUP STATE MACHINE ───────────────────────────────
    if (user.personaSetupPending) {
      await handlePersonaSetup(user, text, chatId);
      return NextResponse.json({ ok: true });
    }

    // ─── COMMAND TYPO CORRECTION ──────────────────────────────────
    // Catches unrecognised slash-commands and suggests the closest match
    if (text.startsWith("/")) {
      const lower = text.toLowerCase();

      // Exact-match typos (full command)
      const EXACT_TYPOS = {
        "/mail":       "/mails",
        "/email":      "/mails",
        "/emails":     "/mails",
        "/prefs":      "/preferences",
        "/pref":       "/preferences",
        "/brief":      "/briefing",
        "/delete":     "/deleteaccount",
        "/connect":    "/connectmail",
        "/disconnect": "/disconnectmail",
        "/file":       "/files",
        "/download":   "ℹ️ Format: `/download <filename>`\n\nUse /files to see your saved files.",
      };

      // Prefix typos — map start of command to replacement prefix
      const PREFIX_TYPOS = [
        ["/read ",     "/readmail "],
        ["/pref ",     "/setpref "],
        ["/profile ",  "/setprofile "],
        ["/brief ",    "/setbriefing "],
      ];

      let reply = null;

      if (EXACT_TYPOS[lower]) {
        const fix = EXACT_TYPOS[lower];
        // If fix starts with ℹ️ it's already a full message, else format as suggestion
        reply = fix.startsWith("ℹ️")
          ? fix
          : `❓ Did you mean \`${fix}\`?\n\nType /help to see all commands.`;
      } else {
        for (const [typo, correct] of PREFIX_TYPOS) {
          if (lower.startsWith(typo)) {
            const fixed = correct + text.slice(typo.length);
            reply = `❓ Did you mean \`${fixed}\`?\n\nType /help to see all commands.`;
            break;
          }
        }
      }

      if (reply) {
        await sendTelegramMessage(reply, chatId);
        return NextResponse.json({ ok: true });
      }

      // Completely unknown command
      await sendTelegramMessage(
        `❓ Unknown command \`${text}\`.\n\nType /help to see all available commands.`,
        chatId
      );
      return NextResponse.json({ ok: true });
    }

    // ─── CHAT FALLBACK ─────────────────────────────────────────────
    const chatQuota = await checkQuota(user, "chat");
    if (!chatQuota.allowed) {
      await sendTelegramMessage(chatQuota.message, chatId);
      return NextResponse.json({ ok: true });
    }

    const history = user.history.slice(-20).map(({ role, content }) => ({ role, content }));
    history.push({ role: "user", content: text });

    // Build context from active files (max 5, 5k chars each)
    const activeFiles = (user.files || [])
      .filter((f) => f.isActive)
      .slice(0, 5)
      .map((f) => `File: ${f.name}\nSummary: ${f.summary || ""}\nContent:\n${(f.extractedText || "").slice(0, 5000)}`)
      .join("\n\n---\n\n");

    const keepTypingChat = setInterval(sendTyping, 4000);

    try {
      const response = await withTimeout(
        generateChatResponse(history, user, activeFiles),
        9000 // 9s — stay under Vercel's 10s limit
      );

      clearInterval(keepTypingChat);

      await User.updateOne(
        { chatId: String(chatId) },
        {
          $push: {
            history: {
              $each: [
                { role: "user", content: text },
                { role: "assistant", content: response },
              ],
              $slice: -20,
            },
          },
        }
      );

      await deductQuota(user, "chat");
      await sendTelegramMessage(response + (chatQuota.warning || ""), chatId);
    } catch (err) {
      clearInterval(keepTypingChat);
      if (err.message === "__timeout__") {
        await sendTelegramMessage(
          "⏱ Response is taking too long. Please try again with a shorter message.",
          chatId
        );
      } else {
        console.error("[Chat Error]:", err.message);
        await sendTelegramMessage(
          "😅 Sorry, I'm having trouble right now. Please try again.",
          chatId
        );
      }
    }
    return NextResponse.json({ ok: true });

  } catch (error) {
    console.error("[Webhook Error]:", error.message);
    // Always inform the user — never silently fail
    try {
      if (webhookChatId) {
        // Escape Markdown special chars in error message to prevent Telegram parse failures
        const safeMsg = (error.message || "Unknown error").replace(/[_*[\]()~`>#+=|{}.!-]/g, "\\$&");
        await sendTelegramMessage(
          "❌ Something went wrong. Please try again.\n\n" +
          `_${safeMsg}_`,
          webhookChatId
        );
      }
    } catch { /* best-effort */ }
    return NextResponse.json({ ok: true });
  }
}
