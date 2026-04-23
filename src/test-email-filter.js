require("dotenv").config({ path: ".env.local" });
const { getRecentEmails } = require("./lib/outlook");
const { analyzeEmails } = require("./lib/ai");

async function testFilter() {
  console.log("🚀 Starting Email Filter Test...");
  
  try {
    console.log("📥 Fetching recent emails (up to 50)...");
    const emails = await getRecentEmails(50);
    console.log(`✅ Fetched ${emails.length} emails.`);

    console.log("🤖 Analyzing emails with AI...");
    const analysis = await analyzeEmails(emails);
    
    console.log("\n--- ANALYSIS RESULT ---");
    console.log(analysis);
    console.log("------------------------\n");
    
    console.log("✨ Test completed successfully.");
  } catch (error) {
    console.error("❌ Test failed:", error.message);
    if (error.message.includes("OUTLOOK_REFRESH_TOKEN")) {
      console.warn("⚠️  Make sure OUTLOOK_REFRESH_TOKEN is set in .env.local");
    }
  }
}

testFilter();
