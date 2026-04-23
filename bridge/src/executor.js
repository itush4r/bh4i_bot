const { adbShell } = require("./adb");

/**
 * Execute a single action on the Android device.
 *
 * Supported actions:
 *   tap      { x, y }
 *   type     { text }
 *   swipe    { x1, y1, x2, y2, duration? }
 *   launch   { package }
 *   back     {}
 *   home     {}
 *   scroll   { direction: "up"|"down"|"left"|"right" }
 *   keyevent { code }  — raw keyevent code
 *
 * @param {string} action
 * @param {object} params
 * @returns {Promise<string>} result description
 */
async function executeAction(action, params = {}) {
  switch (action) {
    case "tap": {
      const { x, y } = params;
      if (x == null || y == null) throw new Error("tap requires x, y");
      await adbShell(`input tap ${Math.round(x)} ${Math.round(y)}`);
      return `Tapped (${x}, ${y})`;
    }

    case "type": {
      const { text } = params;
      if (!text) throw new Error("type requires text");
      // Escape special characters for ADB input
      const escaped = text.replace(/ /g, "%s").replace(/[&;|<>]/g, "");
      await adbShell(`input text "${escaped}"`);
      return `Typed: ${text}`;
    }

    case "swipe": {
      const { x1, y1, x2, y2, duration = 300 } = params;
      if (x1 == null || y1 == null || x2 == null || y2 == null)
        throw new Error("swipe requires x1, y1, x2, y2");
      await adbShell(
        `input swipe ${Math.round(x1)} ${Math.round(y1)} ${Math.round(x2)} ${Math.round(y2)} ${duration}`
      );
      return `Swiped from (${x1},${y1}) to (${x2},${y2})`;
    }

    case "launch": {
      const { package: pkg } = params;
      if (!pkg) throw new Error("launch requires package");
      await adbShell(
        `monkey -p ${pkg} -c android.intent.category.LAUNCHER 1`
      );
      return `Launched ${pkg}`;
    }

    case "back": {
      await adbShell("input keyevent KEYCODE_BACK");
      return "Pressed Back";
    }

    case "home": {
      await adbShell("input keyevent KEYCODE_HOME");
      return "Pressed Home";
    }

    case "scroll": {
      const { direction = "down" } = params;
      // Use swipe gestures to simulate scroll on a ~1080x2400 screen
      const mid = { x: 540, y: 1200 };
      const dist = 600;
      const swipes = {
        down:  { x1: mid.x, y1: mid.y + dist / 2, x2: mid.x, y2: mid.y - dist / 2 },
        up:    { x1: mid.x, y1: mid.y - dist / 2, x2: mid.x, y2: mid.y + dist / 2 },
        left:  { x1: mid.x + dist / 2, y1: mid.y, x2: mid.x - dist / 2, y2: mid.y },
        right: { x1: mid.x - dist / 2, y1: mid.y, x2: mid.x + dist / 2, y2: mid.y },
      };
      const s = swipes[direction] || swipes.down;
      await adbShell(`input swipe ${s.x1} ${s.y1} ${s.x2} ${s.y2} 400`);
      return `Scrolled ${direction}`;
    }

    case "keyevent": {
      const { code } = params;
      if (!code) throw new Error("keyevent requires code");
      await adbShell(`input keyevent ${code}`);
      return `Sent keyevent ${code}`;
    }

    default:
      throw new Error(`Unknown action: ${action}`);
  }
}

module.exports = { executeAction };
