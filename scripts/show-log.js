#!/usr/bin/env node
/* eslint-env node */
/**
 * Show recent app log entries.
 * Usage: npm run log [-- <lines|filter>]
 *   npm run log          # last 30 lines
 *   npm run log -- 100   # last 100 lines
 *   npm run log -- vote  # lines containing "vote"
 */
import fs from "fs";
import path from "path";

const LOG_FILE = path.resolve(process.cwd(), "logs", "app.log");

function formatLine(json) {
  try {
    const obj = JSON.parse(json);
    const time = obj.time ? new Date(obj.time).toLocaleTimeString("en-GB") : "??:??:??";
    const level = (obj.level || "info").toUpperCase().padEnd(5);
    const event = (obj.event || "unknown").padEnd(28);
    const rest = Object.entries(obj)
      .filter(([k]) => !["time", "level", "event"].includes(k))
      .map(([k, v]) => `${k}=${v}`)
      .join(" ");
    return `${time}  ${level}  ${event}  ${rest}`;
  } catch {
    return json;
  }
}

function main() {
  if (!fs.existsSync(LOG_FILE)) {
    console.log("No log file yet. Run the app to generate logs.");
    process.exit(0);
  }

  const arg = process.argv[2];
  const lines = fs.readFileSync(LOG_FILE, "utf8").split("\n").filter(Boolean);

  let output;
  if (arg && /^\d+$/.test(arg)) {
    // Numeric: last N lines
    const n = parseInt(arg, 10);
    output = lines.slice(-n);
  } else if (arg) {
    // String filter
    output = lines.filter((l) => l.includes(arg)).slice(-30);
  } else {
    // Default: last 30
    output = lines.slice(-30);
  }

  if (output.length === 0) {
    console.log("No matching log entries.");
  } else {
    output.forEach((l) => console.log(formatLine(l)));
  }
}

main();
