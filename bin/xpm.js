#!/usr/bin/env node
// XPM command line. Same engine as the web view.
//   xpm check    <manifest.json> [--repos .xpm-repos.json]
//   xpm runs     <manifest.json> --pipeline ID --events DIR
//   xpm simulate <manifest.json> --pipeline ID --events DIR --draft draft.json [--spec out.md]
//   xpm prune    <events-dir> --days 14          (deletes old events AND previews)

const fs = require("fs");
const path = require("path");
const xpm = require("../lib/pipeline");

const ROOT = path.join(__dirname, "..");

function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) out[argv[i].slice(2)] = argv[i + 1], i++;
    else out._.push(argv[i]);
  }
  return out;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf-8"));
}

function pipelineOf(manifest, id) {
  const p = (manifest.pipelines || []).find((x) => x.id === id) || (!id && manifest.pipelines?.[0]);
  if (!p) throw new Error(`pipeline ${id || "(first)"} not found`);
  return p;
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const a = args(rest);
  const manifestFile = a._[0];
  if (!cmd || !manifestFile) {
    console.log("usage: xpm check|runs|simulate <manifest.json> [options]");
    return 2;
  }
  if (cmd === "prune") {
    const days = Number(a.days);
    if (!Number.isFinite(days) || days < 1) throw new Error("--days must be 1 or more");
    const gone = xpm.prune(manifestFile, days);
    console.log(gone.length ? gone.map((f) => `deleted ${f}`).join("\n") : "nothing older than that");
    return 0;
  }
  const manifest = readJson(manifestFile);

  if (cmd === "check") {
    const repos = xpm.loadRepos(a.repos || process.env.XPM_REPOS || path.join(ROOT, ".xpm-repos.json"));
    const report = xpm.checkManifest(manifest, repos);
    for (const r of report) {
      console.log(`${r.ok ? "OK  " : "FAIL"} ${r.pipeline}`);
      r.errors.forEach((e) => console.log(`     schema: ${e}`));
      r.anchors.filter((x) => x.status !== "ok").forEach((x) => console.log(`     ${x.status}: ${x.node}${x.detail ? ` (${x.detail})` : ""}`));
    }
    return report.every((r) => r.ok) ? 0 : 1;
  }

  const p = pipelineOf(manifest, a.pipeline);
  const { events, rejected, scrubbed } = xpm.loadEvents(a.events, p.id, { pipeline: p });
  if (rejected.length) console.error(`${rejected.length} event lines rejected (first: ${rejected[0].reason})`);
  if (scrubbed) console.error(`${scrubbed} decision values dropped or read as "other" (not a label this map names)`);
  const runs = xpm.foldRuns(events);

  if (cmd === "runs") {
    console.log(JSON.stringify(xpm.overlay(p, runs), null, 2));
    return 0;
  }
  if (cmd === "simulate") {
    const draft = readJson(a.draft);
    const result = xpm.simulate(p, draft, runs);
    if (!result.ok) {
      result.errors.forEach((e) => console.error(`draft: ${e}`));
      return 1;
    }
    const spec = xpm.draftToSpec(p, draft, result);
    if (a.spec) fs.writeFileSync(a.spec, spec);
    console.log(spec);
    return 0;
  }
  console.log(`unknown command ${cmd}`);
  return 2;
}

try {
  process.exitCode = main();
} catch (err) {
  console.error(err.message);
  process.exitCode = 2;
}
