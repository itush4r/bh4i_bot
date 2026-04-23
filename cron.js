/**
 * Standalone cron runner for local/self-hosted environments.
 * Runs the daily summary at 9:00 AM IST (3:30 AM UTC) every day.
 *
 * Usage: node cron.js
 */

require("dotenv").config({ path: ".env.local" });

const cron = require("node-cron");
const { runDailySummary } = require("./src/jobs/dailySummary");

console.log("[Cron] Scheduler started. Waiting for 9:00 AM IST daily...");

// 9:00 AM IST = 3:30 AM UTC
cron.schedule("30 3 * * *", async () => {
  console.log(`[Cron] Triggered at ${new Date().toISOString()}`);
  try {
    const result = await runDailySummary();
    console.log("[Cron] Result:", result);
  } catch (error) {
    console.error("[Cron] Failed:", error.message);
  }
});
