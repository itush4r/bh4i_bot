import dbConnect from "../lib/db";
import User from "../models/User";
import { fetchEmails } from "../lib/emailClient";
import { getTopNews } from "../lib/news";
import { generateSummary, analyzeEmails } from "../lib/ai";
import { sendTelegramMessage } from "../lib/telegram";
import { logSummary } from "../lib/logger";
import { deductQuota } from "../lib/quota";

export async function runDailySummary() {
  console.log("[DailySummary] Starting pipeline (9:00 AM IST)...");

  await dbConnect();

  // Find onboarded users whose briefing type is not "none"
  const users = await User.find({
    onboardingComplete: true,
    "briefing.type": { $ne: "none" },
  });

  console.log(`[DailySummary] ${users.length} user(s) eligible`);

  await Promise.allSettled(
    users.map(async (user) => {
      try {
        const briefingType = user.briefing?.type || "both";
        const wantsMails = briefingType === "both" || briefingType === "mails";
        const wantsNews  = briefingType === "both" || briefingType === "news";

        let emails = [];
        let news   = [];

        // Fetch emails if user wants them and has accounts connected
        if (wantsMails && user.emailAccounts?.length > 0) {
          const emailsByAccount = await Promise.allSettled(
            user.emailAccounts.map((account) =>
              fetchEmails(account, user.chatId, user.emailCount || 10)
            )
          );

          const allEmails = emailsByAccount
            .filter((r) => r.status === "fulfilled" && Array.isArray(r.value))
            .flatMap((r) => r.value);

          // Deduplicate by subject + sender
          const seen = new Set();
          emails = allEmails.filter((e) => {
            const key = `${(e.from || "").toLowerCase()}::${(e.subject || "").toLowerCase()}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
        }

        // Fetch news if user wants it
        if (wantsNews) {
          const fetched = await getTopNews(
            user.newsCategories || ["technology", "general"],
            user.newsCount      || 10
          );
          news = Array.isArray(fetched) ? fetched : [];
        }

        // Skip if nothing to send
        if (emails.length === 0 && news.length === 0) {
          console.log(`[DailySummary] Skipping chatId ${user.chatId} — no content`);
          return;
        }

        // Build the briefing
        const header = `🤖 *Daily Briefing — ${new Date().toLocaleDateString("en-IN", {
          weekday: "long", year: "numeric", month: "long", day: "numeric",
        })}*\n\n`;

        let body = "";

        if (wantsNews && news.length > 0) {
          const summary = await generateSummary({ emails: [], news }, user);
          body += `📰 *News*\n${summary}\n\n`;
        }

        if (wantsMails && emails.length > 0) {
          const analysis = await analyzeEmails(emails, user);
          body += `📧 *Emails*\n${analysis}`;
        }

        await sendTelegramMessage(header + body, user.chatId);

        // Mark as sent and deduct quota
        await User.updateOne(
          { chatId: user.chatId },
          { $set: { "briefing.lastSentAt": new Date() } }
        );
        await deductQuota(user, "cron");

        logSummary({ summary: header + body, status: "success", chatId: user.chatId });
        console.log(`[DailySummary] Sent to chatId ${user.chatId} (type: ${briefingType})`);
      } catch (err) {
        console.error(`[DailySummary] Failed for chatId ${user.chatId}:`, err.message);
        logSummary({ summary: null, status: "error", error: err.message, chatId: user.chatId });
      }
    })
  );

  console.log("[DailySummary] Pipeline complete.");
  return { total: users.length };
}
