// Previews: what the person typed, kept apart from the event stream on purpose.
// They live in <events>/previews/YYYY-MM-DD.jsonl, are cut to 120 characters, are pruned
// with the events, and never reach a draft, a simulation result or an exported spec.

const fs = require("fs");
const path = require("path");

const PREVIEW_MAX = 120;
const DAY_FILE = /^(\d{4}-\d{2}-\d{2})\.jsonl$/;

function cleanPreview(text) {
  const flat = String(text ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return flat.length > PREVIEW_MAX ? `${flat.slice(0, PREVIEW_MAX - 1)}…` : flat;
}

/** runId -> text, newest file wins. Missing folder means no previews, never an error. */
function loadPreviews(eventsDir, { maxFiles = 14 } = {}) {
  const out = new Map();
  const dir = eventsDir && path.join(eventsDir, "previews");
  if (!dir || !fs.existsSync(dir)) return out;
  const files = fs.readdirSync(dir).filter((f) => DAY_FILE.test(f)).sort().slice(-maxFiles);
  for (const f of files) {
    for (const line of fs.readFileSync(path.join(dir, f), "utf-8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const r = JSON.parse(line);
        if (typeof r.runId === "string" && typeof r.text === "string") out.set(r.runId, cleanPreview(r.text));
      } catch {
        // A broken line costs one preview, nothing else.
      }
    }
  }
  return out;
}

/** Delete day files older than `days`, events and previews alike. Returns the deleted names. */
function prune(eventsDir, days, now = Date.now()) {
  const cutoff = new Date(now - days * 86400000).toISOString().slice(0, 10);
  const deleted = [];
  for (const dir of [eventsDir, path.join(eventsDir, "previews")]) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      const m = f.match(DAY_FILE);
      if (m && m[1] < cutoff) {
        fs.unlinkSync(path.join(dir, f));
        deleted.push(path.relative(eventsDir, path.join(dir, f)));
      }
    }
  }
  return deleted;
}

module.exports = { PREVIEW_MAX, cleanPreview, loadPreviews, prune };
