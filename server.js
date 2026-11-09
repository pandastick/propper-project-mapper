const express = require("express");
const fs = require("fs");
const path = require("path");

// Load .env file if it exists (no dependency needed)
const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, "utf-8").split("\n").forEach((line) => {
    const match = line.match(/^\s*([\w]+)\s*=\s*(.+?)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  });
}

const app = express();
const PORT = process.env.PORT || 3333;
// Loopback by default: put a proxy (tailscale serve) in front to reach it from elsewhere.
const HOST = process.env.HOST || "127.0.0.1";
// Behind tailscale serve: only these Tailscale logins get in (comma separated). Tagged devices send no login, so they are refused.
const ALLOWED_LOGINS = (process.env.XPM_ALLOWED_LOGINS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const LOOPBACK = ["127.0.0.1", "::1", "localhost"].includes(HOST);
// One folder or several, separated like PATH (":" on macOS and Linux). The first folder that has a project wins.
const MANIFESTS_DIRS = (process.env.MANIFESTS_DIR || path.join(__dirname, "manifests")).split(path.delimiter).filter(Boolean);
const manifestPath = (id) => MANIFESTS_DIRS.map((d) => path.join(d, `${id}.json`)).find((f) => fs.existsSync(f)) || path.join(MANIFESTS_DIRS[0], `${id}.json`);
function manifestFiles() {
  const seen = new Map();
  for (const d of MANIFESTS_DIRS) {
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d).filter((x) => x.endsWith(".json"))) if (!seen.has(f)) seen.set(f, path.join(d, f));
  }
  return [...seen.values()];
}
// Private execution events and drafts live outside git (see .gitignore). Examples ship under examples/.
const EVENTS_DIR = process.env.XPM_EVENTS_DIR || path.join(__dirname, "events");
const DRAFTS_DIR = process.env.XPM_DRAFTS_DIR || path.join(__dirname, "drafts");
const REPOS_FILE = process.env.XPM_REPOS || path.join(__dirname, ".xpm-repos.json");
const EXAMPLES = path.join(__dirname, "examples");
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,80}$/i;
const xpm = require("./lib/pipeline");

// The login header is only trustworthy when nothing but the local proxy can reach this server.
if (ALLOWED_LOGINS.length && !LOOPBACK) {
  console.error("  Refusing to start: XPM_ALLOWED_LOGINS needs HOST on loopback, or the login header can be forged.");
  process.exit(1);
}
if (ALLOWED_LOGINS.length) {
  app.use((req, res, next) => {
    const login = String(req.get("Tailscale-User-Login") || "").toLowerCase();
    if (ALLOWED_LOGINS.includes(login)) return next();
    res.status(403).type("text/plain").send("XPM: this Tailscale login is not allowed.");
  });
}

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json({ limit: "200kb" }));

// Ids become file names: only plain ids, never paths.
app.param("id", (req, res, next, id) => (ID_RE.test(id) ? next() : res.status(400).json({ error: "Bad project id" })));
app.param("pid", (req, res, next, id) => (ID_RE.test(id) ? next() : res.status(400).json({ error: "Bad pipeline id" })));

function readManifest(id) {
  const filePath = manifestPath(id);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function findPipeline(req, res) {
  let manifest;
  try {
    manifest = readManifest(req.params.id);
  } catch (err) {
    res.status(500).json({ error: `Invalid JSON: ${err.message}` });
    return null;
  }
  const pipeline = manifest && (manifest.pipelines || []).find((p) => p.id === req.params.pid);
  if (!pipeline) {
    res.status(404).json({ error: "Pipeline not found" });
    return null;
  }
  return { manifest, pipeline };
}

// Real events win; the example project falls back to its synthetic events.
function eventsDirFor(project) {
  const real = path.join(EVENTS_DIR, project);
  if (fs.existsSync(real)) return real;
  const example = path.join(EXAMPLES, "events", project);
  return project.startsWith("example-") && fs.existsSync(example) ? example : null;
}

// The example project always finds its synthetic repo; a local repos file adds the real ones.
function reposFor(project) {
  const example = project.startsWith("example-") ? xpm.loadRepos(path.join(__dirname, ".xpm-repos.example.json")) : {};
  return { ...example, ...xpm.loadRepos(REPOS_FILE) };
}

// List all available project manifests
app.get("/api/projects", (req, res) => {
  const files = manifestFiles();
  const projects = [];

  files.forEach((f) => {
    try {
      const data = JSON.parse(fs.readFileSync(f, "utf-8"));
      projects.push({
        id: data.id,
        name: data.name,
        description: data.description,
        tech: data.tech,
        screenCount: data.screens?.length || 0,
        entityCount: data.entities?.length || 0,
        pipelineCount: data.pipelines?.length || 0,
      });
    } catch (err) {
      console.error(`  Error reading ${f}: ${err.message}`);
    }
  });

  res.json(projects);
});

// Get a specific project manifest
app.get("/api/project/:id", (req, res) => {
  const filePath = manifestPath(req.params.id);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "Project not found" });
  }
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: `Invalid JSON: ${err.message}` });
  }
});

// Pipeline: the map, its code check, and the last runs laid over it
app.get("/api/project/:id/pipeline/:pid", (req, res) => {
  const found = findPipeline(req, res);
  if (!found) return;
  const { pipeline } = found;
  const errors = xpm.validatePipeline(pipeline);
  const anchors = errors.length ? [] : xpm.checkAnchors(pipeline, reposFor(req.params.id));
  const dir = eventsDirFor(req.params.id);
  const { events, rejected } = xpm.loadEvents(dir, pipeline.id);
  const last50 = xpm.foldRuns(events).slice(0, 50);
  // What the person typed is attached here, for the runs list only. It never enters simulate or a spec.
  const previews = xpm.loadPreviews(dir);
  res.json({
    pipeline,
    check: { errors, anchors },
    overlay: xpm.overlay(pipeline, last50),
    runs: last50.map((r) => ({ ...r, preview: previews.get(r.runId) ?? null })),
    rejectedEvents: rejected.length,
    generatedAt: new Date().toISOString(),
  });
});

// Drafts saved for a pipeline (private folder, examples for the example project)
app.get("/api/project/:id/pipeline/:pid/drafts", (req, res) => {
  const dirs = [path.join(DRAFTS_DIR, req.params.id)];
  if (req.params.id.startsWith("example-")) dirs.push(path.join(EXAMPLES, "drafts"));
  const drafts = [];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json"))) {
      try {
        const d = JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8"));
        const savedAt = fs.statSync(path.join(dir, f)).mtime.toISOString();
        if (!d.pipeline || d.pipeline === req.params.pid) drafts.push({ ...d, file: f, savedAt });
      } catch (err) {
        console.error(`  Error reading draft ${f}: ${err.message}`);
      }
    }
  }
  res.json(drafts);
});

// What-if: replay the recorded runs through a draft. Nothing is written.
app.post("/api/project/:id/pipeline/:pid/simulate", (req, res) => {
  const found = findPipeline(req, res);
  if (!found) return;
  const draft = req.body && typeof req.body === "object" ? req.body : {};
  const runs = xpm.foldRuns(xpm.loadEvents(eventsDirFor(req.params.id), found.pipeline.id).events);
  const result = xpm.simulate(found.pipeline, draft, runs);
  if (!result.ok) return res.status(400).json(result);
  // Only the runs that change route travel back; that is all the result table needs.
  res.json({ ...result, perRun: result.perRun.filter((r) => r.changed), spec: xpm.draftToSpec(found.pipeline, draft, result) });
});

// Validate a manifest (re-reads and reports stats)
app.post("/api/regenerate/:id", (req, res) => {
  const filePath = manifestPath(req.params.id);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ success: false, error: "Manifest not found" });
  }
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    const stats = {
      sections: data.sections?.length || 0,
      screens: data.screens?.length || 0,
      entities: data.entities?.length || 0,
      relationships: data.relationships?.length || 0,
      flows: data.flows?.length || 0,
    };
    res.json({ success: true, stats });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, HOST, () => {
  const count = manifestFiles().length;
  console.log(`\n  XPM (Xcali Project Mapper) running at http://${HOST}:${PORT}${ALLOWED_LOGINS.length ? ` (Tailscale logins: ${ALLOWED_LOGINS.length})` : ""}`);
  console.log(`  Manifests: ${MANIFESTS_DIRS.join(", ")} (${count} projects)\n`);
});
