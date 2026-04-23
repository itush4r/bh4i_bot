const { generateText } = require("ai");
const { google } = require("@ai-sdk/google");
const { buildSystemPrompt, buildBriefingContext } = require("./persona.js");

// Standard flash model for news/email/file analysis
const flashModel     = google("gemini-2.5-flash");
const flashLiteModel = google("gemini-2.5-flash-lite");

// Chat model with Google Search grounding enabled
// Gemini automatically decides when to search — no manual intent detection needed
const flashModelWithSearch = google("gemini-2.5-flash", { useSearchGrounding: true });

async function generateTextWithFallback(options) {
  try {
    return await generateText({ ...options, model: flashModel });
  } catch (error) {
    console.warn("[AI] Primary model failed, falling back to gemini-2.5-flash-lite:", error.message);
    return await generateText({ ...options, model: flashLiteModel });
  }
}

/**
 * Plain-text fallback when the AI provider is unreachable.
 */
function formatNewsWithoutAI({ emails, news }) {
  let output = "";

  if (emails && emails.length > 0) {
    output += "📩 *Emails*\n";
    emails.forEach((e, i) => {
      output += `${i + 1}. *${e.sender}* — ${e.subject}\n`;
    });
    output += "\n";
  }

  if (news && news.length > 0) {
    const tech = news.filter((n) => n.category === "tech");
    const general = news.filter((n) => n.category === "general");

    if (tech.length > 0) {
      output += "💻 *Tech News*\n";
      tech.forEach((n, i) => {
        output += `${i + 1}. ${n.title} — _${n.source}_\n`;
      });
      output += "\n";
    }

    if (general.length > 0) {
      output += "🌍 *General News*\n";
      general.forEach((n, i) => {
        output += `${i + 1}. ${n.title} — _${n.source}_\n`;
      });
    }
  }

  return output || "No updates available right now.";
}

/**
 * Generate a concise bullet-point summary from emails and news.
 * Falls back to plain formatting if the AI provider is unreachable.
 * @param {{ emails: Array, news: Array }} data
 * @param {Object} [user] - Optional user profile for personalization
 * @returns {string} formatted summary text
 */
async function generateSummary({ emails, news }, user) {
  const hasEmails = Array.isArray(emails) && emails.length > 0;
  const hasNews   = Array.isArray(news)   && news.length > 0;

  if (!hasEmails && !hasNews) {
    return "📭 Nothing to report today — no emails or news found.";
  }

  const emailBlock = hasEmails
    ? emails.map((e, i) => `${i + 1}. [${e.sender || e.from}] ${e.subject}\n   ${e.preview || ""}`).join("\n")
    : null;

  const newsBlock = hasNews
    ? news.map((n, i) => `${i + 1}. [${n.category}] ${n.title} — ${n.source}`).join("\n")
    : null;

  const personalization = user?.onboardingComplete ? `\n\n${buildBriefingContext(user)}` : "";

  const prompt =
    `You are a personal assistant. Summarise ONLY the data provided below into crisp bullet points.\n\n` +
    `STRICT RULES:\n` +
    `- ONLY use the emails and news items listed below\n` +
    `- NEVER invent, assume, or add content not in this list\n` +
    `- NEVER use placeholder names, companies, or events\n` +
    `- If a section has no data, skip it cleanly\n` +
    `${personalization}\n\n` +
    (hasEmails ? `📩 EMAILS (${emails.length}):\n${emailBlock}\n\n` : `📩 EMAILS: None today.\n\n`) +
    (hasNews   ? `📰 NEWS (${news.length}):\n${newsBlock}`           : `📰 NEWS: None today.`);

  try {
    const { text } = await generateTextWithFallback({
      prompt,
      maxTokens: 1000,
      temperature: 0.3,
    });
    return text;
  } catch (error) {
    console.warn("[AI] Summary generation failed, using fallback format:", error.message);
    return formatNewsWithoutAI({ emails: hasEmails ? emails : [], news: hasNews ? news : [] });
  }
}

/**
 * Generate a chat response based on conversation history and user profile.
 * @param {Array<{role: string, content: string}>} messages
 * @param {Object} [user] - Optional user profile from MongoDB
 * @returns {Promise<string>} AI response
 */
async function generateChatResponse(history, user, fileContext = "") {
  try {
    const basePrompt = user?.onboardingComplete ? buildSystemPrompt(user) : "";
    const systemPrompt = basePrompt + (
      fileContext
        ? `\n\n## Files the user has shared:\n${fileContext}\n\n` +
          `Reference these files naturally when relevant. ` +
          `Proactively suggest improvements if the conversation is related.`
        : ""
    );

    const { text } = await generateText({
      model:     flashModelWithSearch,
      system:    systemPrompt || undefined,
      messages:  history,
      maxTokens: 500,
      temperature: 0.7,
    });
    return text;
  } catch (error) {
    console.error("[AI] Chat generation failed:", error.message);
    return "😅 Sorry, I'm having a bit of trouble thinking right now. Could you try that again?";
  }
}

/**
 * Categorize and summarize emails, focusing on jobs and bank related messages.
 * @param {Array} emails
 * @param {Object} [user] - Optional user profile for personalization
 * @returns {Promise<string>} Categorized summary
 */
const EMAIL_FOCUS_DEFINITIONS = {
  jobs:        "💼 JOBS: Interview invites, job applications, recruiter messages, career opportunities.",
  finance:     "🏦 FINANCE: Transaction alerts, bank statements, investment updates, payment notifications.",
  newsletters: "📰 NEWSLETTERS: Email newsletters, subscriptions, digests, blogs.",
  promotions:  "🛍️ PROMOTIONS: Deals, discount offers, sale announcements, coupons.",
  social:      "👥 SOCIAL: Social media notifications, invites, friend requests, mentions.",
  updates:     "🔔 UPDATES: System alerts, account notifications, app updates, service announcements.",
};

function buildEmailFocusSections(emailFocus = []) {
  const focusAll = emailFocus.length === 0 || emailFocus.includes("all");

  if (focusAll) {
    return Object.values(EMAIL_FOCUS_DEFINITIONS)
      .map((def, i) => `${i + 1}. ${def}`)
      .join("\n") + `\n${Object.keys(EMAIL_FOCUS_DEFINITIONS).length + 1}. 📁 OTHERS: Anything that doesn't fit above.`;
  }

  const sections = emailFocus
    .filter((f) => EMAIL_FOCUS_DEFINITIONS[f])
    .map((f, i) => `${i + 1}. ${EMAIL_FOCUS_DEFINITIONS[f]}`);

  sections.push(`${sections.length + 1}. 📁 OTHERS: All remaining emails.`);
  return sections.join("\n");
}

async function analyzeEmails(emails, user) {
  if (!Array.isArray(emails) || emails.length === 0) {
    return "📭 Your inbox appears to be empty — no emails were returned.";
  }

  const emailBlock = emails
    .map(
      (e, i) =>
        `${i + 1}. [Sender: ${e.sender || e.from}] [Subject: ${e.subject}]\n   Preview: ${e.preview || ""}`
    )
    .join("\n\n");

  const personalization = user?.onboardingComplete ? `\n\n${buildBriefingContext(user)}` : "";
  const focusSections   = buildEmailFocusSections(user?.emailFocus);

  const prompt =
    `You are an expert personal assistant analysing REAL emails.\n\n` +
    `STRICT RULES:\n` +
    `- ONLY summarise emails from the list below\n` +
    `- NEVER invent, assume, or add emails not in this list\n` +
    `- NEVER use placeholder names like "Project Alpha" or "HR Department"\n` +
    `- If a section has no matching emails, say "No relevant emails."\n` +
    `- Focus on: ${user?.emailFocus?.join(", ") || "all"}\n` +
    `${personalization}\n\n` +
    `Categorise into these sections:\n${focusSections}\n\n` +
    `EMAILS (${emails.length} total):\n${emailBlock}\n\n` +
    `Format with clear headings and emojis. Keep it professional and concise.`;

  try {
    const { text } = await generateTextWithFallback({
      prompt,
      maxTokens: 1500,
      temperature: 0.3,
    });
    return text;
  } catch (error) {
    console.error("[AI] Email analysis failed:", error.message);
    return "⚠️ Couldn't analyse your emails right now. Please try again later.";
  }
}

/**
 * Analyse an uploaded file and return a summary + actionable feedback.
 * Images are handled via Gemini Vision; all other types via text prompt.
 */
async function analyseFile(extractedText, fileName, fileType, user) {
  // ── Images: route through Gemini Vision ──────────────────────────
  if (fileType === "image") {
    const base64 = extractedText.replace("[IMAGE_FILE:", "").replace("]", "");
    try {
      const { text } = await generateText({
        model: flashModel,
        system: user?.onboardingComplete ? buildSystemPrompt(user) : undefined,
        messages: [{
          role: "user",
          content: [
            { type: "image", image: base64 },
            { type: "text",  text:
              `Analyse this image for ${user?.name || "the user"}. ` +
              `Describe what you see, identify the type of document or image, ` +
              `and provide 3-5 specific, actionable suggestions to improve or use it.`
            },
          ],
        }],
      });
      return { summary: text.slice(0, 200), feedback: text };
    } catch (error) {
      console.error("[AI] Image analysis failed:", error.message);
      return { summary: "Image file", feedback: "⚠️ Couldn't analyse this image. Try again." };
    }
  }

  // ── Text-based files ─────────────────────────────────────────────
  const fileContext = extractedText.slice(0, 15000);

  try {
    const { text: feedback } = await generateTextWithFallback({
      prompt:
        `You have received a ${fileType.toUpperCase()} file named "${fileName}" ` +
        `from ${user?.name || "a user"} (${user?.profession || "professional"} based in ${user?.city || "India"}).\n\n` +
        `File content:\n${fileContext}\n\n` +
        `Provide:\n` +
        `1. A 2-3 sentence summary of what this file is\n` +
        `2. 3-5 specific, actionable suggestions to improve it\n` +
        `3. Any red flags or important things to note\n\n` +
        `RULES:\n` +
        `- Be direct and specific — no generic advice\n` +
        `- Reference actual content from the file\n` +
        `- Use Telegram markdown formatting\n` +
        `- Keep total response under 400 words`,
      maxTokens: 600,
      temperature: 0.4,
    });

    const { text: summary } = await generateText({
      model: flashLiteModel,
      prompt: `Summarise this file in one sentence (max 150 chars): ${fileContext.slice(0, 2000)}`,
      maxTokens: 60,
    });

    return { summary: summary.trim(), feedback };
  } catch (error) {
    console.error("[AI] File analysis failed:", error.message);
    return { summary: `${fileType.toUpperCase()} file`, feedback: "⚠️ Couldn't analyse this file. Try again." };
  }
}

/**
 * Rewrite a section of a file based on a user instruction.
 */
async function rewriteFileSection(extractedText, section, instruction, fileName, user) {
  try {
    const { text } = await generateTextWithFallback({
      prompt:
        `You are helping ${user?.name || "a user"} improve their file: "${fileName}".\n\n` +
        `Full file content:\n${extractedText.slice(0, 15000)}\n\n` +
        `Task: ${instruction}\n` +
        `Section to focus on: ${section || "the entire document"}\n\n` +
        `RULES:\n` +
        `- Rewrite only the requested section\n` +
        `- Match the tone and style of the rest of the document\n` +
        `- Be specific and professional\n` +
        `- Output ONLY the rewritten section, no preamble`,
      maxTokens: 800,
      temperature: 0.5,
    });
    return text;
  } catch (error) {
    console.error("[AI] File rewrite failed:", error.message);
    return null;
  }
}

module.exports = {
  generateSummary,
  generateChatResponse,
  formatNewsWithoutAI,
  analyzeEmails,
  analyseFile,
  rewriteFileSection,
};
