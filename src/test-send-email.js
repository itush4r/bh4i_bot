require("dotenv").config({ path: ".env.local" });
const { sendEmail } = require("./lib/outlook");

async function testSend() {
  console.log("🚀 Starting Send Email Test...");
  const testRecipient = "tushar.tomar@example.com"; // Placeholder, normally user would provide
  const testSubject = "Test from Chotu AI Bot";
  const testBody = "Hello! This is a test email sent from the Chotu AI Assistant bot.";

  try {
    console.log(`📤 Attempting to send email to ${testRecipient}...`);
    await sendEmail(testRecipient, testSubject, testBody);
    console.log("✅ Email sent successfully according to the API.");
  } catch (error) {
    console.error("❌ Send Test failed:", error.message);
    if (error.message.includes("OUTLOOK_REFRESH_TOKEN")) {
      console.warn("⚠️  Make sure OUTLOOK_REFRESH_TOKEN is set in .env.local");
    }
  }
}

testSend();
