// `xpm check`: every node that claims a place in the code must still be there.
// This is what separates the map from an AI drawing: a stale node fails loudly.

const fs = require("fs");
const path = require("path");
const { validatePipeline } = require("./schema");

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** repos: { name: absolute root }. Returns one result per anchored node. */
function checkAnchors(pipeline, repos) {
  const results = [];
  for (const n of pipeline.nodes) {
    if (!n.anchor) {
      results.push({ node: n.id, status: "unanchored" });
      continue;
    }
    const { repo, path: rel, symbol } = n.anchor;
    const root = repos[repo];
    if (!root) {
      results.push({ node: n.id, status: "no-repo", detail: `repo ${repo} is not in the repos file` });
      continue;
    }
    const abs = path.resolve(root, rel);
    if (abs !== path.resolve(root) && !abs.startsWith(path.resolve(root) + path.sep)) {
      results.push({ node: n.id, status: "missing-file", detail: `${rel} points outside ${repo}` });
      continue;
    }
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      results.push({ node: n.id, status: "missing-file", detail: `${repo}:${rel}` });
      continue;
    }
    if (symbol) {
      const text = fs.readFileSync(abs, "utf-8");
      if (!new RegExp(`\\b${escapeRe(symbol)}\\b`).test(text)) {
        results.push({ node: n.id, status: "missing-symbol", detail: `${symbol} not in ${repo}:${rel}` });
        continue;
      }
    }
    results.push({ node: n.id, status: "ok" });
  }
  return results;
}

const BAD = new Set(["missing-file", "missing-symbol", "no-repo"]);

/** Schema errors plus anchor results for every pipeline in a manifest. */
function checkManifest(manifest, repos) {
  const report = [];
  for (const p of manifest.pipelines || []) {
    const errors = validatePipeline(p);
    const anchors = errors.length ? [] : checkAnchors(p, repos);
    report.push({ pipeline: p.id, errors, anchors, ok: !errors.length && !anchors.some((a) => BAD.has(a.status)) });
  }
  return report;
}

function loadRepos(file) {
  if (!file || !fs.existsSync(file)) return {};
  const raw = JSON.parse(fs.readFileSync(file, "utf-8"));
  const base = path.dirname(file);
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, path.resolve(base, v.replace(/^~(?=\/)/, process.env.HOME || "~"))]));
}

module.exports = { checkAnchors, checkManifest, loadRepos, BAD };
