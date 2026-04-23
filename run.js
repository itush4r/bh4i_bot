/**
 * Run the daily summary pipeline on demand.
 * Usage: node run.js
 *
 * No server needed — just run this whenever you want your briefing.
 */

require("dotenv").config({ path: ".env.local" });

const { runDailySummary } = require("./src/jobs/dailySummary");

(async () => {
  console.log("🚀 Fetching news and generating summary...\n");
  try {
    const result = await runDailySummary();
    console.log("\n✅ Done!", result);
  } catch (error) {
    console.error("\n❌ Failed:", error.message);
    process.exit(1);
  }
})();
