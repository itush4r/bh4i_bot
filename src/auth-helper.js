require("dotenv").config({ path: ".env.local" });
const readline = require("readline");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

async function getRefreshToken() {
  const { OUTLOOK_CLIENT_ID, OUTLOOK_CLIENT_SECRET, OUTLOOK_TENANT_ID } = process.env;

  if (!OUTLOOK_CLIENT_ID || !OUTLOOK_CLIENT_SECRET || !OUTLOOK_TENANT_ID) {
    console.error("❌ Error: OUTLOOK_CLIENT_ID, OUTLOOK_CLIENT_SECRET, or OUTLOOK_TENANT_ID is missing in .env.local");
    process.exit(1);
  }

  const scope = "https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Mail.Send offline_access";
  const redirectUri = "http://localhost:3000";

  const authUrl = `https://login.microsoftonline.com/${OUTLOOK_TENANT_ID}/oauth2/v2.0/authorize?client_id=${OUTLOOK_CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&response_mode=query&scope=${encodeURIComponent(scope)}&state=12345`;

  console.log("\n1️⃣  Visit this URL in your browser and log in:\n");
  console.log(authUrl);
  console.log("\n2️⃣  After logging in, you will be redirected to localhost (which might fail, that's fine).");
  console.log("3️⃣  Copy the 'code' parameter from the URL in your browser's address bar.");

  rl.question("\n4️⃣  Paste the code here: ", async (input) => {
    try {
      // Robustly extract the code if the user pasted the full URL or query string
      let code = input.trim();
      if (code.includes("code=")) {
        code = new URL(code.startsWith("http") ? code : `http://localhost?${code}`).searchParams.get("code");
      } else if (code.includes("&")) {
        code = code.split("&")[0];
      }

      if (!code) {
        throw new Error("Could not find a valid code in your input. Please copy just the 'code' value from the URL.");
      }

      console.log("\n⏳ Exchanging code for tokens...");
      const response = await fetch(
        `https://login.microsoftonline.com/${OUTLOOK_TENANT_ID}/oauth2/v2.0/token`,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: OUTLOOK_CLIENT_ID,
            scope: scope,
            code: code,
            redirect_uri: redirectUri,
            grant_type: "authorization_code",
            client_secret: OUTLOOK_CLIENT_SECRET,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error_description || data.error || "Unknown error");
      }

      console.log("\n✅ Success! Your Refresh Token is:\n");
      console.log("--------------------------------------------------------------------------------");
      console.log(data.refresh_token);
      console.log("--------------------------------------------------------------------------------");
      console.log("\nCopy the long string above and paste it into OUTLOOK_REFRESH_TOKEN in .env.local");
      
      process.exit(0);
    } catch (error) {
      console.error("\n❌ Failed to exchange code:", error.message);
      process.exit(1);
    }
  });
}

getRefreshToken();
