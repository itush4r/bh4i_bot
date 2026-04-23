/**
 * Opens an ngrok tunnel and optionally registers the URL with the bot.
 */

let tunnelUrl = null;

async function startTunnel(port) {
  const ngrokToken = process.env.NGROK_AUTH_TOKEN;
  if (!ngrokToken) {
    console.log("[Tunnel] No NGROK_AUTH_TOKEN set — skipping tunnel. Use manual URL.");
    return null;
  }

  try {
    const ngrok = require("ngrok");
    await ngrok.authtoken(ngrokToken);
    tunnelUrl = await ngrok.connect(port);
    console.log(`[Tunnel] Public URL: ${tunnelUrl}`);

    // Auto-register with bot if configured
    const registerUrl = process.env.BOT_REGISTER_URL;
    const chatId = process.env.BOT_REGISTER_CHAT_ID;
    if (registerUrl && chatId) {
      try {
        const res = await fetch(registerUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chatId,
            bridgeUrl: tunnelUrl,
            bridgeSecret: process.env.BRIDGE_SECRET,
          }),
        });
        if (res.ok) {
          console.log("[Tunnel] Auto-registered with bot successfully.");
        } else {
          console.warn("[Tunnel] Auto-register failed:", await res.text());
        }
      } catch (err) {
        console.warn("[Tunnel] Auto-register error:", err.message);
      }
    }

    return tunnelUrl;
  } catch (err) {
    console.error("[Tunnel] Failed to start ngrok:", err.message);
    return null;
  }
}

function getTunnelUrl() {
  return tunnelUrl;
}

module.exports = { startTunnel, getTunnelUrl };
