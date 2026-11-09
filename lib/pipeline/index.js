const fs = require("fs");
const path = require("path");
const events = require("./events");
const schema = require("./schema");
const runs = require("./runs");
const check = require("./check");
const simulate = require("./simulate");

/** Read every .jsonl under a folder (or one file), keep one pipeline's events, newest days first. */
function loadEvents(target, pipelineId, { maxFiles = 14 } = {}) {
  if (!target || !fs.existsSync(target)) return { events: [], rejected: [] };
  const files = fs.statSync(target).isDirectory()
    ? fs.readdirSync(target).filter((f) => f.endsWith(".jsonl")).sort().reverse().slice(0, maxFiles).map((f) => path.join(target, f))
    : [target];
  const all = [];
  const rejected = [];
  for (const f of files) {
    const r = events.parseJsonl(fs.readFileSync(f, "utf-8"));
    all.push(...r.events);
    rejected.push(...r.rejected.map((x) => ({ ...x, file: path.basename(f) })));
  }
  const kept = pipelineId ? all.filter((e) => !e.pipeline || e.pipeline === pipelineId) : all;
  return { events: kept, rejected };
}

module.exports = { ...events, ...schema, ...runs, ...check, ...simulate, loadEvents };
