require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env.local") });

const express = require("express");
const { getAppListFast } = require("./apps");
const { executeAction } = require("./executor");
const { captureScreenshot, getScreenSize } = require("./screen");
const { startTunnel, getTunnelUrl } = require("./tunnel");

const app = express();
app.use(express.json());

const BRIDGE_SECRET = process.env.BRIDGE_SECRET;
const PORT = parseInt(process.env.PORT || "7777", 10);

// ─── Auth middleware ──────────────────────────────────────────────────────────
app.use((req, res, next) => {
  if (req.path === "/health") return next(); // health is public
  const secret = req.headers["x-bridge-secret"];
  if (!secret || secret !== BRIDGE_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
});

// ─── GET /health ──────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ ok: true, tunnel: getTunnelUrl() || "none" });
});

// ─── GET /apps ────────────────────────────────────────────────────────────────
app.get("/apps", async (_req, res) => {
  try {
    const apps = await getAppListFast();
    res.json({ ok: true, apps });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── GET /screenshot ──────────────────────────────────────────────────────────
app.get("/screenshot", async (_req, res) => {
  try {
    const base64 = await captureScreenshot();
    const screen = await getScreenSize();
    res.json({ ok: true, image: base64, screen });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── POST /execute ────────────────────────────────────────────────────────────
app.post("/execute", async (req, res) => {
  try {
    const { action, params } = req.body;
    if (!action) return res.status(400).json({ ok: false, error: "Missing action" });
    const result = await executeAction(action, params || {});
    res.json({ ok: true, result });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`[Bridge] Listening on port ${PORT}`);
  await startTunnel(PORT);
});
