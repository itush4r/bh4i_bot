const { adbShell, adbRaw } = require("./adb");
const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const TEMP_PATH = path.join(os.tmpdir(), "bridge_screenshot.png");

/**
 * Capture a screenshot from the connected Android device.
 * @returns {Promise<string>} base64-encoded PNG
 */
async function captureScreenshot() {
  // Take screenshot on device
  await adbShell("screencap -p /sdcard/screen.png");

  // Pull to local temp
  await new Promise((resolve, reject) => {
    execFile(
      "adb",
      ["pull", "/sdcard/screen.png", TEMP_PATH],
      { timeout: 10000 },
      (err) => (err ? reject(err) : resolve())
    );
  });

  // Read and encode
  const buffer = fs.readFileSync(TEMP_PATH);
  const base64 = buffer.toString("base64");

  // Cleanup
  try { fs.unlinkSync(TEMP_PATH); } catch {}
  try { await adbShell("rm /sdcard/screen.png"); } catch {}

  return base64;
}

/**
 * Get screen resolution.
 * @returns {Promise<{width: number, height: number}>}
 */
async function getScreenSize() {
  const raw = await adbShell("wm size");
  const match = raw.match(/(\d+)x(\d+)/);
  if (!match) throw new Error("Could not determine screen size");
  return { width: parseInt(match[1]), height: parseInt(match[2]) };
}

module.exports = { captureScreenshot, getScreenSize };
