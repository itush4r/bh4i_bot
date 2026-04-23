const fs = require("fs");
const path = require("path");

const LOG_DIR = path.join(process.cwd(), "logs");
const LOG_FILE = path.join(LOG_DIR, "summary-history.json");

/**
 * Log a summary run result to a local JSON file.
 * @param {{ summary: string, status: string, error?: string }} entry
 */
function logSummary(entry) {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }

  let history = [];
  if (fs.existsSync(LOG_FILE)) {
    try {
      history = JSON.parse(fs.readFileSync(LOG_FILE, "utf-8"));
    } catch {
      history = [];
    }
  }

  history.push({
    timestamp: new Date().toISOString(),
    status: entry.status,
    summary: entry.summary || null,
    error: entry.error || null,
  });

  // Keep only last 100 entries
  if (history.length > 100) {
    history = history.slice(-100);
  }

  fs.writeFileSync(LOG_FILE, JSON.stringify(history, null, 2));
}

module.exports = { logSummary };
