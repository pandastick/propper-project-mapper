// Where a project's code really lives, and how XPM is set up for it.
// XPM adapts to each product: it never asks a product to change how it deploys.
// The profile says which tree is the TRUTH (what the map is checked against) and, optionally, a MIRROR
// (usually GitHub) that XPM compares with and reports on, but never enforces.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const CODE = /\.(ts|tsx|js|mjs|cjs|py|sh|html|css|service|timer)$/;
const SKIP = new Set(["node_modules", ".git", "__pycache__", ".venv", "venv", "dist", "build", ".pytest_cache", "fixtures", "tests"]);
const MAX_FILES = 5000;

/** Problems with a profile, as sentences. Empty means valid. */
function validateProfile(p) {
  const errors = [];
  if (!p || typeof p !== "object") return ["profile is not an object"];
  if (!p.truth || typeof p.truth.repo !== "string") errors.push("truth.repo is required: the repo name, mapped to a folder in the repos file");
  if (p.mirror) {
    if (typeof p.mirror.checkout !== "string") errors.push("mirror.checkout is required: a repo name or a folder holding a git checkout");
    if (!Array.isArray(p.mirror.paths) || !p.mirror.paths.length) errors.push("mirror.paths lists the folders to compare, for example [\"telegram\"]");
    for (const x of p.mirror.paths || []) if (typeof x !== "string" || x.split("/").includes("..") || path.isAbsolute(x)) errors.push(`mirror path ${x} must be relative`);
  }
  if (p.traces && p.traces.previews !== undefined && typeof p.traces.previews !== "boolean") errors.push("traces.previews is true or false");
  return errors;
}

/** The id git gives a file's bytes. Comparing these needs no checkout of the other side. */
function blobSha(buf) {
  return crypto.createHash("sha1").update(`blob ${buf.length}\0`).update(buf).digest("hex");
}

function walk(root, rel, out) {
  if (out.size >= MAX_FILES) return;
  let entries;
  try {
    entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (SKIP.has(e.name) || e.name.startsWith(".") || /\.(bak|orig)|\.PRE-|~$/.test(e.name)) continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    let st;
    try {
      st = fs.statSync(path.join(root, r)); // follows the symlinked folders a box layout uses
    } catch {
      continue;
    }
    if (st.isDirectory()) { if (r.split("/").length < 8) walk(root, r, out); }
    else if (st.isFile() && CODE.test(e.name)) out.set(r, blobSha(fs.readFileSync(path.join(root, r))));
  }
}

/**
 * Compare the truth tree with a git ref in the mirror checkout, file by file.
 * truthRoot/<path> is compared with <prefix>/<path> at the ref. Nothing is written; fetch only when asked.
 */
function compareMirror({ truthRoot, checkout, ref = "origin/main", paths, prefix = "", fetch = false }) {
  const git = (...a) => execFileSync("git", ["-C", checkout, ...a], { encoding: "utf8", maxBuffer: 64 << 20, timeout: 30000 });
  let fetched = null;
  if (fetch) {
    try { git("fetch", "--quiet", "origin"); fetched = new Date().toISOString(); } catch (err) { fetched = `failed: ${String(err.message).split("\n")[0].slice(0, 120)}`; }
  }
  const commit = git("rev-parse", ref).trim();
  const commitDate = git("show", "-s", "--format=%cI", commit).trim();
  const mirror = new Map();
  const gitPaths = paths.map((p) => path.posix.join(prefix, p));
  for (const line of git("ls-tree", "-r", commit, "--", ...gitPaths).split("\n")) {
    const m = line.match(/^\d+ blob ([0-9a-f]{40})\t(.+)$/);
    if (!m) continue;
    const rel = prefix ? path.posix.relative(prefix, m[2]) : m[2];
    const parts = rel.split("/");
    if (!CODE.test(rel) || parts.some((x) => SKIP.has(x) || x.startsWith("."))) continue;
    mirror.set(rel, m[1]);
  }
  const truth = new Map();
  for (const p of paths) {
    const inner = new Map();
    walk(path.join(truthRoot, p), "", inner);
    for (const [k, v] of inner) truth.set(`${p}/${k}`, v);
  }
  const differ = [], onlyTruth = [], onlyMirror = [];
  let same = 0;
  for (const [f, sha] of truth) {
    if (!mirror.has(f)) onlyTruth.push(f);
    else if (mirror.get(f) !== sha) differ.push(f);
    else same += 1;
  }
  for (const f of mirror.keys()) if (!truth.has(f)) onlyMirror.push(f);
  return { ref, commit: commit.slice(0, 7), commitDate, fetched, same, differ: differ.sort(), onlyTruth: onlyTruth.sort(), onlyMirror: onlyMirror.sort() };
}

function loadProfiles(file) {
  if (!file || !fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, "utf-8"));
}

/**
 * The six settings, each with what is TRUE on this machine right now, not just what the profile claims.
 * status: ok | missing | note. Missing is a problem; note is a fact worth seeing.
 */
function setupFacts(profile, ctx) {
  const rows = [];
  const add = (key, label, status, value, detail) => rows.push({ key, label, status, value, detail });
  if (!profile) {
    add("truth", "Truth", "missing", "Not set up", "XPM does not know where this project's code lives. Add a profile for it.");
    return { configured: false, rows };
  }
  const truthPath = ctx.repos[profile.truth?.repo];
  add("truth", "Truth", truthPath && fs.existsSync(truthPath) ? "ok" : "missing",
    profile.truth?.label || profile.truth?.repo,
    truthPath ? `repo ${profile.truth.repo} → ${truthPath}${fs.existsSync(truthPath) ? "" : " (not found on this machine)"}` : `repo ${profile.truth?.repo} is not in the repos file`);

  if (!profile.mirror) add("mirror", "Mirror", "note", "none", "Nothing to compare with.");
  else if (ctx.mirror?.error) add("mirror", "Mirror", "missing", profile.mirror.label || profile.mirror.checkout, ctx.mirror.error);
  else if (ctx.mirror) {
    const m = ctx.mirror;
    const n = m.differ.length + m.onlyTruth.length;
    const value = n ? `${n} ${n === 1 ? "file" : "files"} ahead of ${profile.mirror.label || m.ref}` : `matches ${profile.mirror.label || m.ref}`;
    add("mirror", "Mirror", "note", value, `${m.ref} at ${m.commit}, committed ${m.commitDate.slice(0, 10)}${m.fetched ? `, fetched ${String(m.fetched).slice(0, 16)}` : ", not fetched by XPM"}. ${m.differ.length} differ, ${m.onlyTruth.length} only in the truth, ${m.onlyMirror.length} only in the mirror, ${m.same} the same.`);
  }

  const here = ctx.hostname;
  const runsOn = profile.runsOn;
  add("runsOn", "XPM runs on", !runsOn || runsOn === here ? "ok" : "note",
    runsOn ? (runsOn === here ? `${here} (this machine)` : `${runsOn}, but this XPM is on ${here}`) : here,
    runsOn && runsOn !== here ? `The truth lives on ${runsOn}. Here the map is checked against ${truthPath || "nothing"}, which may not be the truth.` : "Where the truth and the traces are readable.");

  const t = profile.traces || {};
  const dir = ctx.eventsDir;
  let files = [];
  try { files = dir && fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort() : []; } catch { files = []; }
  const previewsFound = !!dir && fs.existsSync(path.join(dir, "previews"));
  const tracesValue = files.length ? `${files.length} ${files.length === 1 ? "day" : "days"} of traces, newest ${files[files.length - 1].slice(0, 10)}` : "no traces yet";
  const previewsText = t.previews ? "previews on" : "previews off";
  const mismatch = !t.previews && previewsFound;
  add("traces", "Traces", mismatch ? "missing" : "note", `${tracesValue} · ${previewsText}`,
    `${t.writer ? `Written by ${t.writer}. ` : ""}${dir ? `Folder ${dir}.` : "No events folder."}${mismatch ? " Previews were found although the profile says off." : ""}${(t.neverPreview || []).length ? ` Never previewed: ${t.neverPreview.join(", ")}.` : ""}`);

  const gate = ctx.allowedLogins > 0;
  // Previews show what a person typed: without a login gate that is a problem, unless the data is declared public (synthetic).
  const accessStatus = t.previews && !gate && !profile.access?.public ? "missing" : "ok";
  add("access", "Who can open it", accessStatus,
    gate ? `${ctx.allowedLogins} Tailscale ${ctx.allowedLogins === 1 ? "login" : "logins"}` : ctx.loopback ? "this machine, and whatever proxy fronts it" : "anyone who can reach this port",
    `${profile.access?.label ? `${profile.access.label}. ` : ""}${accessStatus === "missing" ? "Previews are on without a login gate: set XPM_ALLOWED_LOGINS." : ""}`.trim());

  const c = profile.confirmed;
  add("owner", "Map owner", c ? "ok" : "note", profile.mapOwner || "nobody named",
    c ? `Confirmed by ${c.by} on ${c.at}${c.note ? `: ${c.note}` : ""}.` : "The map has not been confirmed against the truth yet.");
  return { configured: true, rows };
}

module.exports = { validateProfile, compareMirror, blobSha, loadProfiles, setupFacts };
