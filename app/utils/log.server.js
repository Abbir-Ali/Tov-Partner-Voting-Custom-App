/**
 * App log utility. Always writes to console; in dev, also appends JSON lines to logs/app.log.
 * Never log personal data: no emails, names, notes, tokens, or full request bodies.
 * Shop domain, board id, counts, status and error codes are fine.
 */
import fs from "fs";
import path from "path";

const LOG_DIR = path.resolve(process.cwd(), "logs");
const LOG_FILE = path.join(LOG_DIR, "app.log");
const IS_PROD = process.env.NODE_ENV === "production";

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function write(level, event, data = {}) {
  const time = new Date().toISOString();
  const msg = `[${time}] ${level.toUpperCase()} ${event} ${JSON.stringify(data)}`;

  // Always console
  if (level === "error") {
    console.error(msg);
  } else {
    console.log(msg);
  }

  // In dev, also append to file
  if (!IS_PROD) {
    try {
      ensureLogDir();
      const line = JSON.stringify({ time, level, event, ...data }) + "\n";
      fs.appendFileSync(LOG_FILE, line);
    } catch {
      // Ignore file write errors
    }
  }
}

export const log = {
  info: (event, data) => write("info", event, data),
  warn: (event, data) => write("warn", event, data),
  error: (event, data) => write("error", event, data),
};
