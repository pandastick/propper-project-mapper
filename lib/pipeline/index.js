const fs = require("fs");
const path = require("path");
const events = require("./events");
const schema = require("./schema");
const runs = require("./runs");
const check = require("./check");
const simulate = require("./simulate");
const previews = require("./previews");
const source = require("./source");

const DAY_FILE = /^\d{4}-\d{2}-\d{2}\.jsonl$/;

/**
 * Read the newest day files under a folder (or one file) and keep one pipeline's events.
 * Pass the pipeline itself and decision values the map does not name are replaced with "other".
 * `scrubbed` counts decision values that were dropped or replaced.
 */
function loadEvents(target, pipelineId, { maxFiles = 14, pipeline = null } = {}) {
  if (!target || !fs.existsSync(target)) return { events: [], rejected: [], scrubbed: 0 };
  const files = fs.statSync(target).isDirectory()
    ? fs.readdirSync(target).filter((f) => DAY_FILE.test(f)).sort().reverse().slice(0, maxFiles).map((f) => path.join(target, f))
    : [target];
  const all = [];
  const rejected = [];
  let scrubbed = 0;
  for (const f of files) {
    const r = events.parseJsonl(fs.readFileSync(f, "utf-8"));
    all.push(...r.events);
    scrubbed += r.dropped;
    rejected.push(...r.rejected.map((x) => ({ ...x, file: path.basename(f) })));
  }
  let kept = pipelineId ? all.filter((e) => !e.pipeline || e.pipeline === pipelineId) : all;
  if (pipeline) {
    const s = events.scrubDecisions(kept, pipeline);
    kept = s.events;
    scrubbed += s.replaced;
  }
  return { events: kept, rejected, scrubbed };
}

module.exports = { ...events, ...schema, ...runs, ...check, ...simulate, ...previews, ...source, loadEvents };
